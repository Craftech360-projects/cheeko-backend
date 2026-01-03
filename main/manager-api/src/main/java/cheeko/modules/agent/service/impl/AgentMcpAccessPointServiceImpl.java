package cheeko.modules.agent.service.impl;

import java.net.URI;
import java.net.URISyntaxException;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.concurrent.TimeUnit;
import java.util.stream.Collectors;

import org.apache.commons.lang3.StringUtils;
import org.springframework.stereotype.Service;

import lombok.AllArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import cheeko.common.constant.Constant;
import cheeko.common.utils.AESUtils;
import cheeko.common.utils.HashEncryptionUtil;
import cheeko.common.utils.JsonUtils;
import cheeko.modules.agent.Enums.CheekoMcpJsonRpcJson;
import cheeko.modules.agent.service.AgentMcpAccessPointService;
import cheeko.modules.sys.service.SysParamsService;
import cheeko.modules.sys.utils.WebSocketClientManager;

@AllArgsConstructor
@Service
@Slf4j
public class AgentMcpAccessPointServiceImpl implements AgentMcpAccessPointService {
    private SysParamsService sysParamsService;

    @Override
    public String getAgentMcpAccessAddress(String id) {
        // Get到mcps Address
        String url = sysParamsService.getValue(Constant.SERVER_MCP_ENDPOINT, true);
        if (StringUtils.isBlank(url) || "null".equals(url)) {
            return null;
        }
        URI uri = getURI(url);
        // GetAgentmcps url前缀
        String agentMcpUrl = getAgentMcpUrl(uri);
        // GetSecret Key
        String key = getSecretKey(uri);
        // GetEncrypts token
        String encryptToken = encryptToken(id, key);
        // 对token进行URLCode
        String encodedToken = URLEncoder.encode(encryptToken, StandardCharsets.UTF_8);
        // ReturnAgentMcpPaths 格式
        agentMcpUrl = "%s/mcp/?token=%s".formatted(agentMcpUrl, encodedToken);
        return agentMcpUrl;
    }

    @Override
    public List<String> getAgentMcpToolsList(String id) {
        String wsUrl = getAgentMcpAccessAddress(id);
        if (StringUtils.isBlank(wsUrl)) {
            return List.of();
        }

        // 将 /mcp 替换As /call
        wsUrl = wsUrl.replace("/mcp/", "/call/");

        try {
            // Create WebSocket Connection，增加TimeoutTime到15Second
            try (WebSocketClientManager client = WebSocketClientManager.build(
                    new WebSocketClientManager.Builder()
                            .uri(wsUrl)
                            .bufferSize(1024 * 1024)
                            .connectTimeout(8, TimeUnit.SECONDS)
                            .maxSessionDuration(10, TimeUnit.SECONDS))) {

                // 步骤1: SendInitializeMessage并WaitResponse
                log.info("SendMCPInitializeMessage，AgentID: {}", id);
                client.sendText(CheekoMcpJsonRpcJson.getInitializeJson());

                // WaitInitializeResponse (id=1) - 移Except固定延迟，改AsResponse驱动
                List<String> initResponses = client.listenerWithoutClose(response -> {
                    try {
                        Map<String, Object> jsonMap = JsonUtils.parseObject(response, Map.class);
                        if (jsonMap != null && Integer.valueOf(1).equals(jsonMap.get("id"))) {
                            // CheckWhetherHaveresultField，Table示InitializeSuccess
                            return jsonMap.containsKey("result") && !jsonMap.containsKey("error");
                        }
                        return false;
                    } catch (Exception e) {
                        log.warn("ParseInitializeResponseFailure: {}", response, e);
                        return false;
                    }
                });

                // ValidateInitializeResponse
                boolean initSucceeded = false;
                for (String response : initResponses) {
                    try {
                        Map<String, Object> jsonMap = JsonUtils.parseObject(response, Map.class);
                        if (jsonMap != null && Integer.valueOf(1).equals(jsonMap.get("id"))) {
                            if (jsonMap.containsKey("result")) {
                                log.info("MCPInitializeSuccess，AgentID: {}", id);
                                initSucceeded = true;
                                break;
                            } else if (jsonMap.containsKey("error")) {
                                log.error("MCPInitializeFailure，AgentID: {}, Error: {}", id, jsonMap.get("error"));
                                return List.of();
                            }
                        }
                    } catch (Exception e) {
                        log.warn("HandleInitializeResponseFailure: {}", response, e);
                    }
                }

                if (!initSucceeded) {
                    log.error("未收到Valids MCPInitializeResponse，AgentID: {}", id);
                    return List.of();
                }

                // 步骤2: SendInitialize完成Notification - OnlyHave在收到initializeResponse后ThenSend
                log.info("SendMCPInitialize完成Notification，AgentID: {}", id);
                client.sendText(CheekoMcpJsonRpcJson.getNotificationsInitializedJson());
                // 步骤3: SendUtilsListRequest - 立即Send，无需额外延迟
                log.info("SendMCPUtilsListRequest，AgentID: {}", id);
                client.sendText(CheekoMcpJsonRpcJson.getToolsListJson());

                // WaitUtilsListResponse (id=2)
                List<String> toolsResponses = client.listener(response -> {
                    try {
                        Map<String, Object> jsonMap = JsonUtils.parseObject(response, Map.class);
                        return jsonMap != null && Integer.valueOf(2).equals(jsonMap.get("id"));
                    } catch (Exception e) {
                        log.warn("ParseUtilsListResponseFailure: {}", response, e);
                        return false;
                    }
                });

                // HandleUtilsListResponse
                for (String response : toolsResponses) {
                    try {
                        Map<String, Object> jsonMap = JsonUtils.parseObject(response, Map.class);
                        if (jsonMap != null && Integer.valueOf(2).equals(jsonMap.get("id"))) {
                            // CheckWhetherHaveresultField
                            Object resultObj = jsonMap.get("result");
                            if (resultObj instanceof Map) {
                                Map<String, Object> resultMap = (Map<String, Object>) resultObj;
                                Object toolsObj = resultMap.get("tools");
                                if (toolsObj instanceof List) {
                                    List<Map<String, Object>> toolsList = (List<Map<String, Object>>) toolsObj;
                                    // 提取UtilsNameList
                                    List<String> result = toolsList.stream()
                                            .map(tool -> (String) tool.get("name"))
                                            .filter(name -> name != null)
                                            .collect(Collectors.toList());
                                    log.info("SuccessGetMCPUtilsList，AgentID: {}, UtilsQuantity: {}", id, result.size());
                                    return result;
                                }
                            } else if (jsonMap.containsKey("error")) {
                                log.error("GetUtilsListFailure，AgentID: {}, Error: {}", id, jsonMap.get("error"));
                                return List.of();
                            }
                        }
                    } catch (Exception e) {
                        log.warn("HandleUtilsListResponseFailure: {}", response, e);
                    }
                }

                log.warn("未找到Valids UtilsListResponse，AgentID: {}", id);
                return List.of();

            }
        } catch (Exception e) {
            log.error("GetAgent MCP UtilsListFailure，AgentID: {},Error原因：{}", id, e.getMessage());
            return List.of();
        }
    }

    /**
     * GetURIObject
     * 
     * @param url Path
     * @return URIObject
     */
    private static URI getURI(String url) {
        try {
            return new URI(url);
        } catch (URISyntaxException e) {
            log.error("Path格式不正确Path：{}，\nErrorInformation:{}", url, e.getMessage());
            throw new RuntimeException("mcps AddressExistError，请进入Parameter ManagementUpdatemcpAccess PointAddress");
        }
    }

    /**
     * GetSecret Key
     *
     * @param uri mcpAddress
     * @return Secret Key
     */
    private static String getSecretKey(URI uri) {
        // GetParameter
        String query = uri.getQuery();
        // GetaesEncryptSecret Key
        String str = "key=";
        return query.substring(query.indexOf(str) + str.length());
    }

    /**
     * GetAgentmcpAccess Pointurl
     *
     * @param uri mcpAddress
     * @return AgentmcpAccess Pointurl
     */
    private String getAgentMcpUrl(URI uri) {
        // Get协议
        String wsScheme = (uri.getScheme().equals("https")) ? "wss" : "ws";
        // GetHost，Port，Path
        String path = uri.getSchemeSpecificPart();
        // Get到Last一个/前s path
        path = path.substring(0, path.lastIndexOf("/"));
        return wsScheme + ":" + path;
    }

    /**
     * Get对AgentidEncrypts token
     *
     * @param agentId Agentid
     * @param key     EncryptSecret Key
     * @return Encrypt后token
     */
    private static String encryptToken(String agentId, String key) {
        // Usemd5对Agentid进行Encrypt
        String md5 = HashEncryptionUtil.Md5hexDigest(agentId);
        // aesRequiredEncryptText
        String json = "{\"agentId\": \"%s\"}".formatted(md5);
        // Encrypt后成token值
        return AESUtils.encrypt(key, json);
    }
}