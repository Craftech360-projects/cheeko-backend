package cheeko.modules.sys.dao;

import java.util.List;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import cheeko.common.dao.BaseDao;
import cheeko.modules.sys.entity.SysParamsEntity;

/**
 * Parameter Management
 */
@Mapper
public interface SysParamsDao extends BaseDao<SysParamsEntity> {
    /**
     * ByParameter Code，Queryvalue
     *
     * @param paramCode Parameter Code
     * @return Parameter Value
     */
    String getValueByCode(String paramCode);

    /**
     * GetParameter CodeList
     *
     * @param ids ids
     * @return ReturnParameter CodeList
     */
    List<String> getParamCodeList(String[] ids);

    /**
     * ByParameter Code，Updatevalue
     *
     * @param paramCode  Parameter Code
     * @param paramValue Parameter Value
     */
    int updateValueByCode(@Param("paramCode") String paramCode, @Param("paramValue") String paramValue);
}
