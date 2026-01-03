package cheeko.modules.sys.entity;

import java.util.Date;

import com.baomidou.mybatisplus.annotation.FieldFill;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableName;

import lombok.Data;
import lombok.EqualsAndHashCode;
import cheeko.common.entity.BaseEntity;

/**
 * Data Dictionary
 */
@Data
@EqualsAndHashCode(callSuper = false)
@TableName("sys_dict_data")
public class SysDictDataEntity extends BaseEntity {
    /**
     * Dictionary type ID
     */
    private Long dictTypeId;
    /**
     * Dictionary Label
     */
    private String dictLabel;
    /**
     * Dictionary Value
     */
    private String dictValue;
    /**
     * Remark
     */
    private String remark;
    /**
     * Sort Order
     */
    private Integer sort;
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