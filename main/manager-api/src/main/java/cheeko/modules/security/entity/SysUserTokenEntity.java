package cheeko.modules.security.entity;

import java.io.Serializable;
import java.util.Date;

import com.baomidou.mybatisplus.annotation.FieldFill;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;

import lombok.Data;

/**
 * System UserToken
 */
@Data
@TableName("sys_user_token")
public class SysUserTokenEntity implements Serializable {

    /**
     * id
     */
    @TableId
    private Long id;
    /**
     * UserID
     */
    private Long userId;
    /**
     * Usertoken
     */
    private String token;
    /**
     * ExpiredTime
     */
    private Date expireDate;
    /**
     * Update Time
     */
    private Date updateDate;
    /**
     * Create Time
     */
    @TableField(fill = FieldFill.INSERT)
    private Date createDate;

}