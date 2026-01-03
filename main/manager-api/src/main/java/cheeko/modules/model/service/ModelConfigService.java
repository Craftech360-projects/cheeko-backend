package cheeko.modules.model.service;

import java.util.List;

import cheeko.common.page.PageData;
import cheeko.common.service.BaseService;
import cheeko.modules.model.dto.LlmModelBasicInfoDTO;
import cheeko.modules.model.dto.ModelBasicInfoDTO;
import cheeko.modules.model.dto.ModelConfigBodyDTO;
import cheeko.modules.model.dto.ModelConfigDTO;
import cheeko.modules.model.entity.ModelConfigEntity;

public interface ModelConfigService extends BaseService<ModelConfigEntity> {

    List<ModelBasicInfoDTO> getModelCodeList(String modelType, String modelName);

    List<LlmModelBasicInfoDTO> getLlmModelCodeList(String modelName);

    PageData<ModelConfigDTO> getPageList(String modelType, String modelName, String page, String limit);

    ModelConfigDTO add(String modelType, String provideCode, ModelConfigBodyDTO modelConfigBodyDTO);

    ModelConfigDTO edit(String modelType, String provideCode, String id, ModelConfigBodyDTO modelConfigBodyDTO);

    void delete(String id);

    /**
     * ByIDGetModelName
     * 
     * @param id ModelID
     * @return ModelName
     */
    String getModelNameById(String id);

    /**
     * ByIDGetModelConfiguration
     * 
     * @param id      ModelID
     * @param isCache WhetherCache
     * @return ModelConfigurationEntity
     */
    ModelConfigEntity getModelById(String id, boolean isCache);

    /**
     * SetDefaultModel
     * 
     * @param modelType ModelType
     * @param isDefault WhetherDefault
     */
    void setDefaultModel(String modelType, int isDefault);
}
