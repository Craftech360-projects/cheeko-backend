package cheeko.modules.sys.service;

import java.util.List;
import java.util.Map;

import cheeko.common.page.PageData;
import cheeko.common.service.BaseService;
import cheeko.modules.sys.dto.SysParamsDTO;
import cheeko.modules.sys.entity.SysParamsEntity;

/**
 * Parameter Management
 */
public interface SysParamsService extends BaseService<SysParamsEntity> {

    PageData<SysParamsDTO> page(Map<String, Object> params);

    List<SysParamsDTO> list(Map<String, Object> params);

    SysParamsDTO get(Long id);

    void save(SysParamsDTO dto);

    void update(SysParamsDTO dto);

    void delete(String[] ids);

    /**
     * Get parameter value by parameter code
     *
     * @param paramCode Parameter code
     * @param fromCache Whether to get from cache
     */
    String getValue(String paramCode, Boolean fromCache);

    /**
     * Get value object by parameter code
     *
     * @param paramCode Parameter code
     * @param clazz     Object class
     */
    <T> T getValueObject(String paramCode, Class<T> clazz);

    /**
     * Update value by parameter code
     *
     * @param paramCode  Parameter code
     * @param paramValue Parameter value
     */
    int updateValueByCode(String paramCode, String paramValue);

    /**
     * Initialize service server secret key
     */
    void initServerSecret();
}
