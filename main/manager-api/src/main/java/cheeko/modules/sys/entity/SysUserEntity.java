package cheeko.modules.sys.entity;

import java.util.Date;

import com.baomidou.mybatisplus.annotation.FieldFill;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableName;

import lombok.Data;
import lombok.EqualsAndHashCode;
import cheeko.common.entity.BaseEntity;

/**
 * System User
 */
@Data
@EqualsAndHashCode(callSuper = false)
@TableName("sys_user")
public class SysUserEntity extends BaseEntity {
    /**
     * Username
     */
    private String username;
    /**
     * Password
     */
    private String password;
    /**
     * Super Admin 0: No 1: Yes
     */
    private Integer superAdmin;
    /**
     * Status 0：Disabled 1：Normal
     */
    private Integer status;
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