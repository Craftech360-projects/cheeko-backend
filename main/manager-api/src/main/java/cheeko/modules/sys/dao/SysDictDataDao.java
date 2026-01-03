package cheeko.modules.sys.dao;

import java.util.List;

import org.apache.ibatis.annotations.Mapper;

import cheeko.common.dao.BaseDao;
import cheeko.modules.sys.entity.SysDictDataEntity;
import cheeko.modules.sys.vo.SysDictDataItem;

/**
 * Dictionary Data
 */
@Mapper
public interface SysDictDataDao extends BaseDao<SysDictDataEntity> {

    List<SysDictDataItem> getDictDataByType(String dictType);

    /**
     * Get dictionary type code by dictionary type ID
     * 
     * @param dictTypeId Dictionary type ID
     * @return Dictionary type code
     */
    String getTypeByTypeId(Long dictTypeId);
}
