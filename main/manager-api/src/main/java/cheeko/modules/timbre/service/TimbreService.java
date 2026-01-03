package cheeko.modules.timbre.service;

import java.util.List;

import cheeko.common.page.PageData;
import cheeko.common.service.BaseService;
import cheeko.modules.model.dto.VoiceDTO;
import cheeko.modules.timbre.dto.TimbreDataDTO;
import cheeko.modules.timbre.dto.TimbrePageDTO;
import cheeko.modules.timbre.entity.TimbreEntity;
import cheeko.modules.timbre.vo.TimbreDetailsVO;

/**
 * Timbres Service Layers Definition
 * 
 * @author zjy
 * @since 2025-3-21
 */
public interface TimbreService extends BaseService<TimbreEntity> {
    /**
     * PaginationGetTimbrespecifiedttsunderTimbre
     * 
     * @param dto PaginationQueryParameter
     * @return TimbreListPaginationData
     */
    PageData<TimbreDetailsVO> page(TimbrePageDTO dto);

    /**
     * GetTimbrespecifiedids DetailsInformation
     * 
     * @param timbreId TimbreTableid
     * @return TimbreInformation
     */
    TimbreDetailsVO get(String timbreId);

    /**
     * SaveTimbreInformation
     * 
     * @param dto RequiredSaveData
     */
    void save(TimbreDataDTO dto);

    /**
     * SaveTimbreInformation
     * 
     * @param timbreId RequiredUpdates id
     * @param dto      RequiredUpdates Data
     */
    void update(String timbreId, TimbreDataDTO dto);

    /**
     * BatchDeleteTimbre
     * 
     * @param ids RequiredTo beDeletes TimbreidList
     */
    void delete(String[] ids);

    List<VoiceDTO> getVoiceNames(String ttsModelId, String voiceName);

    /**
     * ByIDGetTimbreName
     * 
     * @param id TimbreID
     * @return TimbreName
     */
    String getTimbreNameById(String id);
}