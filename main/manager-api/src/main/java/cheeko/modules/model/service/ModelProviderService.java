package cheeko.modules.model.service;

import java.util.Collection;
import java.util.List;

import cheeko.common.page.PageData;
import cheeko.modules.model.dto.ModelProviderDTO;

public interface ModelProviderService {

    List<ModelProviderDTO> getPluginList();

    ModelProviderDTO getById(String id);

    List<ModelProviderDTO> getPluginListByIds(Collection<String> ids);

    List<ModelProviderDTO> getListByModelType(String modelType);

    ModelProviderDTO add(ModelProviderDTO modelProviderDTO);

    ModelProviderDTO edit(ModelProviderDTO modelProviderDTO);

    void delete(String id);

    void delete(List<String> id);

    PageData<ModelProviderDTO> getListPage(ModelProviderDTO modelProviderDTO, String page, String limit);

    List<ModelProviderDTO> getList(String modelType, String provideCode);
}
