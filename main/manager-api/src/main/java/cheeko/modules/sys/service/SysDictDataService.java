package cheeko.modules.sys.service;

import java.util.List;
import java.util.Map;

import cheeko.common.page.PageData;
import cheeko.common.service.BaseService;
import cheeko.modules.sys.dto.SysDictDataDTO;
import cheeko.modules.sys.entity.SysDictDataEntity;
import cheeko.modules.sys.vo.SysDictDataItem;
import cheeko.modules.sys.vo.SysDictDataVO;

/**
 * Data Dictionary
 */
public interface SysDictDataService extends BaseService<SysDictDataEntity> {

    /**
     * Pagination query data dictionary information
     *
     * @param params Query parameters, including pagination information and query conditions
     * @return Returns data dictionary pagination query result
     */
    PageData<SysDictDataVO> page(Map<String, Object> params);

    /**
     * Get data dictionary entity by ID
     *
     * @param id Data dictionary entity unique identifier
     * @return Returns data dictionary entity detailed information
     */
    SysDictDataVO get(Long id);

    /**
     * Save new data dictionary item
     *
     * @param dto Data dictionary item save data transfer object
     */
    void save(SysDictDataDTO dto);

    /**
     * Update data dictionary item
     *
     * @param dto Data dictionary item update data transfer object
     */
    void update(SysDictDataDTO dto);

    /**
     * Delete data dictionary item
     *
     * @param ids Data dictionary item ID array to delete
     */
    void delete(Long[] ids);

    /**
     * Delete corresponding dictionary data by dictionary type ID
     *
     * @param dictTypeId Dictionary type ID
     */
    void deleteByTypeId(Long dictTypeId);

    /**
     * Get dictionary data list by dictionary type
     *
     * @param dictType Dictionary type
     * @return Returns dictionary data list
     */
    List<SysDictDataItem> getDictDataByType(String dictType);

}