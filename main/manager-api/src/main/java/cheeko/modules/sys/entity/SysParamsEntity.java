package cheeko.modules.sys.entity;

import java.util.Date;

import com.baomidou.mybatisplus.annotation.FieldFill;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableName;

import lombok.Data;
import lombok.EqualsAndHashCode;
import cheeko.common.entity.BaseEntity;

/**
 * Parameter Management
 */
@Data
@EqualsAndHashCode(callSuper = false)
@TableName("sys_params")
public class SysParamsEntity extends BaseEntity {
    /**
     * Parameter Code
     */
    private String paramCode;
    /**
     * Parameter Value
     */
    private String paramValue;
    /**
     * Value Type：string-String，number-Number，boolean-Boolean，array-Array
     */
    private String valueType;
    /**
     * Type 0：System Parameter 1：NonSystem Parameter
     */
    private Integer paramType;
    /**
     * Remark
     */
    private String remark;
    /**
     * Updater
     */
    @TableField(fill = FieldFill.INSERT_UPDATE)
    private Long updater;
    /**
     * Update Time
     */
    @TableField(fill = FieldFill.INSERT_UPDATE)
    private Date updateDate;

}