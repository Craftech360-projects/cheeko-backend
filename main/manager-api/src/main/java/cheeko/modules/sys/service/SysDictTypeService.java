package cheeko.modules.sys.service;

import java.util.List;
import java.util.Map;

import cheeko.common.page.PageData;
import cheeko.common.service.BaseService;
import cheeko.modules.sys.dto.SysDictTypeDTO;
import cheeko.modules.sys.entity.SysDictTypeEntity;
import cheeko.modules.sys.vo.SysDictTypeVO;

/**
 * Data Dictionary
 */
public interface SysDictTypeService extends BaseService<SysDictTypeEntity> {

    /**
     * Pagination query dictionary type information
     *
     * @param params Query parameters, including pagination information and query conditions
     * @return Returns paginated dictionary type data
     */
    PageData<SysDictTypeVO> page(Map<String, Object> params);

    /**
     * Get dictionary type information by ID
     *
     * @param id Dictionary type ID
     * @return Returns dictionary type object
     */
    SysDictTypeVO get(Long id);

    /**
     * Save dictionary type information
     *
     * @param dto Dictionary type data transfer object
     */
    void save(SysDictTypeDTO dto);

    /**
     * Update dictionary type information
     *
     * @param dto Dictionary type data transfer object
     */
    void update(SysDictTypeDTO dto);

    /**
     * Delete dictionary type information
     *
     * @param ids Dictionary type ID array to delete
     */
    void delete(Long[] ids);

    /**
     * List all dictionary type information
     *
     * @return Returns dictionary type list
     */
    List<SysDictTypeVO> list(Map<String, Object> params);
}