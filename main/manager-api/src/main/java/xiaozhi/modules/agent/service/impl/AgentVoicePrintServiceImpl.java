package xiaozhi.modules.agent.service.impl;

import java.net.URI;
import java.net.URISyntaxException;
import java.util.List;
import java.util.concurrent.Executor;
import java.util.stream.Collectors;

import org.apache.commons.lang3.StringUtils;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.core.io.ByteArrayResource;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.util.MultiValueMap;
import org.springframework.web.client.RestTemplate;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;

import lombok.extern.slf4j.Slf4j;
import xiaozhi.common.constant.Constant;
import xiaozhi.common.exception.RenException;
import xiaozhi.common.utils.ConvertUtils;
import xiaozhi.common.utils.JsonUtils;
import xiaozhi.modules.agent.dao.AgentVoicePrintDao;
import xiaozhi.modules.agent.dto.AgentVoicePrintSaveDTO;
import xiaozhi.modules.agent.dto.AgentVoicePrintUpdateDTO;
import xiaozhi.modules.agent.dto.IdentifyVoicePrintResponse;
import xiaozhi.modules.agent.entity.AgentVoicePrintEntity;
import xiaozhi.modules.agent.service.AgentChatAudioService;
import xiaozhi.modules.agent.service.AgentChatHistoryService;
import xiaozhi.modules.agent.service.AgentVoicePrintService;
import xiaozhi.modules.agent.vo.AgentVoicePrintVO;
import xiaozhi.modules.sys.service.SysParamsService;

/**
 * @author zjy
 */
@Service
@Slf4j
public class AgentVoicePrintServiceImpl extends ServiceImpl<AgentVoicePrintDao, AgentVoicePrintEntity>
        implements AgentVoicePrintService {
    private final AgentChatAudioService agentChatAudioService;
    private final RestTemplate restTemplate;
    private final SysParamsService sysParamsService;
    private final AgentChatHistoryService agentChatHistoryService;
    // Spring programmatic transaction class
    private final TransactionTemplate transactionTemplate;
    // Recognition threshold
    private final Double RECOGNITION = 0.5;
    private final Executor taskExecutor;

    public AgentVoicePrintServiceImpl(AgentChatAudioService agentChatAudioService, RestTemplate restTemplate,
                                      SysParamsService sysParamsService, AgentChatHistoryService agentChatHistoryService,
                                      TransactionTemplate transactionTemplate, @Qualifier("taskExecutor") Executor taskExecutor) {
        this.agentChatAudioService = agentChatAudioService;
        this.restTemplate = restTemplate;
        this.sysParamsService = sysParamsService;
        this.agentChatHistoryService = agentChatHistoryService;
        this.transactionTemplate = transactionTemplate;
        this.taskExecutor = taskExecutor;
    }

    @Override
    public boolean insert(AgentVoicePrintSaveDTO dto) {
        // Get audio data
        ByteArrayResource resource = getVoicePrintAudioWAV(dto.getAgentId(), dto.getAudioId());
        // Check if this voice has been registered
        IdentifyVoicePrintResponse response = identifyVoicePrint(dto.getAgentId(), resource);
        if (response != null && response.getScore() > RECOGNITION) {
            // Query user info by recognized voiceprint ID
            AgentVoicePrintEntity existingVoicePrint = baseMapper.selectById(response.getSpeakerId());
            String existingUserName = existingVoicePrint != null ? existingVoicePrint.getSourceName() : "Unknown user";
            throw new RenException("This voice is already registered to (" + existingUserName + "), please use a different voice");
        }
        AgentVoicePrintEntity entity = ConvertUtils.sourceToTarget(dto, AgentVoicePrintEntity.class);
        // Start transaction
        return Boolean.TRUE.equals(transactionTemplate.execute(status -> {
            try {
                // Save voiceprint info
                int row = baseMapper.insert(entity);
                // If affected rows != 1, rollback
                if (row != 1) {
                    status.setRollbackOnly(); // Mark transaction rollback
                    return false;
                }
                // Send voiceprint registration request
                registerVoicePrint(entity.getId(), resource);
                return true;
            } catch (RenException e) {
                status.setRollbackOnly(); // Mark transaction rollback
                throw e;
            } catch (Exception e) {
                status.setRollbackOnly(); // Mark transaction rollback
                log.error("Voiceprint save error: {}", e.getMessage());
                throw new RenException("Failed to save voiceprint, please contact administrator");
            }
        }));
    }

    @Override
    public boolean delete(Long userId, String voicePrintId) {
        // Start transaction
        boolean b = Boolean.TRUE.equals(transactionTemplate.execute(status -> {
            try {
                // Delete voiceprint for current logged-in user and agent
                int row = baseMapper.delete(new LambdaQueryWrapper<AgentVoicePrintEntity>()
                        .eq(AgentVoicePrintEntity::getId, voicePrintId)
                        .eq(AgentVoicePrintEntity::getCreator, userId));
                if (row != 1) {
                    status.setRollbackOnly(); // Mark transaction rollback
                    return false;
                }

                return true;
            } catch (Exception e) {
                status.setRollbackOnly(); // Mark transaction rollback
                log.error("Voiceprint deletion error: {}", e.getMessage());
                throw new RenException("Failed to delete voiceprint");
            }
        }));
        // Only proceed to delete voiceprint service data if database deletion succeeded
        if(b){
            taskExecutor.execute(()-> {
                try {
                    cancelVoicePrint(voicePrintId);
                }catch (RuntimeException e) {
                    log.error("Voiceprint deletion runtime error: {}, id: {}", e.getMessage(),voicePrintId);
                }
            });
        }
        return b;
    }

    @Override
    public List<AgentVoicePrintVO> list(Long userId, String agentId) {
        // Find data for current logged-in user and agent
        List<AgentVoicePrintEntity> list = baseMapper.selectList(new LambdaQueryWrapper<AgentVoicePrintEntity>()
                .eq(AgentVoicePrintEntity::getAgentId, agentId)
                .eq(AgentVoicePrintEntity::getCreator, userId));
        return list.stream().map(entity -> {
            // Convert to AgentVoicePrintVO type
            return ConvertUtils.sourceToTarget(entity, AgentVoicePrintVO.class);
        }).toList();

    }

    @Override
    public boolean update(Long userId, AgentVoicePrintUpdateDTO dto) {
        AgentVoicePrintEntity agentVoicePrintEntity = baseMapper
                .selectOne(new LambdaQueryWrapper<AgentVoicePrintEntity>()
                        .eq(AgentVoicePrintEntity::getId, dto.getId())
                        .eq(AgentVoicePrintEntity::getCreator, userId));
        if (agentVoicePrintEntity == null) {
            return false;
        }
        // Get audio ID
        String audioId = dto.getAudioId();
        // Get agent ID
        String agentId = agentVoicePrintEntity.getAgentId();
        ByteArrayResource resource;
        // If audioId is not empty and different from previous, regenerate voiceprint
        if (!StringUtils.isEmpty(audioId) && !audioId.equals(agentVoicePrintEntity.getAudioId())) {
            resource = getVoicePrintAudioWAV(agentId, audioId);

            // Check if this voice is already registered
            IdentifyVoicePrintResponse response = identifyVoicePrint(agentId, resource);
            // Score above RECOGNITION means this voiceprint already exists
            if (response != null && response.getScore() > RECOGNITION) {
                // If returned ID is not the one being modified, the voice is already registered
                if (!response.getSpeakerId().equals(dto.getId())) {
                    // Query user info by recognized voiceprint ID
                    AgentVoicePrintEntity existingVoicePrint = baseMapper.selectById(response.getSpeakerId());
                    String existingUserName = existingVoicePrint != null ? existingVoicePrint.getSourceName() : "Unknown user";
                    throw new RenException("Modification not allowed, this voice is already registered to (" + existingUserName + ")");
                }
            }
        } else {
            resource = null;
        }
        // Start transaction
        return Boolean.TRUE.equals(transactionTemplate.execute(status -> {
            try {
                AgentVoicePrintEntity entity = ConvertUtils.sourceToTarget(dto, AgentVoicePrintEntity.class);
                int row = baseMapper.updateById(entity);
                if (row != 1) {
                    status.setRollbackOnly(); // Mark transaction rollback
                    return false;
                }
                if (resource != null) {
                    String id = entity.getId();
                    // First cancel the previous voiceprint vector
                    cancelVoicePrint(id);
                    // Send voiceprint registration request
                    registerVoicePrint(id, resource);
                }
                return true;
            } catch (RenException e) {
                status.setRollbackOnly(); // Mark transaction rollback
                throw e;
            } catch (Exception e) {
                status.setRollbackOnly(); // Mark transaction rollback
                log.error("Voiceprint update error: {}", e.getMessage());
                throw new RenException("Failed to update voiceprint, please contact administrator");
            }
        }));
    }

    /**
     * Get voiceprint API URI object
     *
     * @return URI object
     */
    private URI getVoicePrintURI() {
        // Get voiceprint API address
        String voicePrint = sysParamsService.getValue(Constant.SERVER_VOICE_PRINT, true);
        try {
            return new URI(voicePrint);
        } catch (URISyntaxException e) {
            log.error("Invalid path format: {}, error: {}", voicePrint, e.getMessage());
            throw new RuntimeException("Voiceprint API address is invalid, please update in parameter management");
        }
    }

    /**
     * Get voiceprint base URL path
     *
     * @param uri Voiceprint address URI
     * @return Base path
     */
    private String getBaseUrl(URI uri) {
        String protocol = uri.getScheme();
        String host = uri.getHost();
        int port = uri.getPort();
        if (port == -1) {
            return "%s://%s".formatted(protocol, host);
        } else {
            return "%s://%s:%s".formatted(protocol, host, port);
        }
    }

    /**
     * Get Authorization header
     *
     * @param uri Voiceprint address URI
     * @return Authorization value
     */
    private String getAuthorization(URI uri) {
        // Get query parameters
        String query = uri.getQuery();
        // Get AES encryption key
        String str = "key=";
        return "Bearer " + query.substring(query.indexOf(str) + str.length());
    }

    /**
     * Get voiceprint audio resource data
     *
     * @param audioId Audio ID
     * @return Voiceprint audio resource data
     */
    private ByteArrayResource getVoicePrintAudioWAV(String agentId, String audioId) {
        // Check if this audio belongs to the current agent
        boolean b = agentChatHistoryService.isAudioOwnedByAgent(audioId, agentId);
        if (!b) {
            throw new RenException("Audio data does not belong to this agent");
        }
        // Get audio data
        byte[] audio = agentChatAudioService.getAudio(audioId);
        // If audio data is empty, throw error
        if (audio == null || audio.length == 0) {
            throw new RenException("Audio data is empty, please check uploaded data");
        }
        // Wrap byte array as resource and return
        return new ByteArrayResource(audio) {
            @Override
            public String getFilename() {
                return "VoicePrint.WAV"; // Set filename
            }
        };
    }

    /**
     * Send voiceprint registration HTTP request
     *
     * @param id       Voiceprint ID
     * @param resource Voiceprint audio resource
     */
    private void registerVoicePrint(String id, ByteArrayResource resource) {
        // Process voiceprint API address, get prefix
        URI uri = getVoicePrintURI();
        String baseUrl = getBaseUrl(uri);
        String requestUrl = baseUrl + "/voiceprint/register";
        // Create request body
        MultiValueMap<String, Object> body = new LinkedMultiValueMap<>();
        body.add("speaker_id", id);
        body.add("file", resource);

        // Create request headers
        HttpHeaders headers = new HttpHeaders();
        headers.set("Authorization", getAuthorization(uri));
        headers.setContentType(MediaType.MULTIPART_FORM_DATA);
        // Create request entity
        HttpEntity<MultiValueMap<String, Object>> requestEntity = new HttpEntity<>(body, headers);
        // Send POST request
        ResponseEntity<String> response = restTemplate.postForEntity(requestUrl, requestEntity, String.class);

        if (response.getStatusCode() != HttpStatus.OK) {
            log.error("Voiceprint registration failed, request URL: {}", requestUrl);
            throw new RenException("Failed to save voiceprint, request unsuccessful");
        }
        // Check response content
        String responseBody = response.getBody();
        if (responseBody == null || !responseBody.contains("true")) {
            log.error("Voiceprint registration failed, response: {}", responseBody == null ? "empty content" : responseBody);
            throw new RenException("Failed to save voiceprint, request processing failed");
        }
    }

    /**
     * Send voiceprint cancellation request
     *
     * @param voicePrintId Voiceprint ID
     */
    private void cancelVoicePrint(String voicePrintId) {
        URI uri = getVoicePrintURI();
        String baseUrl = getBaseUrl(uri);
        String requestUrl = baseUrl + "/voiceprint/" + voicePrintId;
        // Create request headers
        HttpHeaders headers = new HttpHeaders();
        headers.set("Authorization", getAuthorization(uri));
        // Create request entity
        HttpEntity<MultiValueMap<String, Object>> requestEntity = new HttpEntity<>(headers);

        // Send DELETE request
        ResponseEntity<String> response = restTemplate.exchange(requestUrl, HttpMethod.DELETE, requestEntity,
                String.class);
        if (response.getStatusCode() != HttpStatus.OK) {
            log.error("Voiceprint cancellation failed, request URL: {}", requestUrl);
            throw new RenException("Failed to cancel voiceprint, request unsuccessful");
        }
        // Check response content
        String responseBody = response.getBody();
        if (responseBody == null || !responseBody.contains("true")) {
            log.error("Voiceprint cancellation failed, response: {}", responseBody == null ? "empty content" : responseBody);
            throw new RenException("Failed to cancel voiceprint, request processing failed");
        }
    }

    /**
     * Send voiceprint identification HTTP request
     *
     * @param agentId  Agent ID
     * @param resource Voiceprint audio resource
     * @return Recognition result data
     */
    private IdentifyVoicePrintResponse identifyVoicePrint(String agentId, ByteArrayResource resource) {

        // Get all registered voiceprints for this agent
        List<AgentVoicePrintEntity> agentVoicePrintList = baseMapper
                .selectList(new LambdaQueryWrapper<AgentVoicePrintEntity>()
                        .select(AgentVoicePrintEntity::getId)
                        .eq(AgentVoicePrintEntity::getAgentId, agentId));

        // If no voiceprints registered, no need to send identification request
        if (agentVoicePrintList.isEmpty()) {
            return null;
        }
        // Process voiceprint API address, get prefix
        URI uri = getVoicePrintURI();
        String baseUrl = getBaseUrl(uri);
        String requestUrl = baseUrl + "/voiceprint/identify";
        // Create request body
        MultiValueMap<String, Object> body = new LinkedMultiValueMap<>();

        // Create speaker_id parameter
        String speakerIds = agentVoicePrintList.stream()
                .map(AgentVoicePrintEntity::getId)
                .collect(Collectors.joining(","));
        body.add("speaker_ids", speakerIds);
        body.add("file", resource);

        // Create request headers
        HttpHeaders headers = new HttpHeaders();
        headers.set("Authorization", getAuthorization(uri));
        headers.setContentType(MediaType.MULTIPART_FORM_DATA);
        // Create request entity
        HttpEntity<MultiValueMap<String, Object>> requestEntity = new HttpEntity<>(body, headers);
        // Send POST request
        ResponseEntity<String> response = restTemplate.postForEntity(requestUrl, requestEntity, String.class);

        if (response.getStatusCode() != HttpStatus.OK) {
            log.error("Voiceprint identification request failed, request URL: {}", requestUrl);
            throw new RenException("Failed to identify voiceprint, request unsuccessful");
        }
        // Check response content
        String responseBody = response.getBody();
        if (responseBody != null) {
            return JsonUtils.parseObject(responseBody, IdentifyVoicePrintResponse.class);
        }
        return null;
    }
}
