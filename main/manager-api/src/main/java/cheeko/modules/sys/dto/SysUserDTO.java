package cheeko.modules.sys.dto;

import java.io.Serializable;
import java.util.Date;
import java.util.List;

import org.hibernate.validator.constraints.Range;

import com.fasterxml.jackson.annotation.JsonFormat;
import com.fasterxml.jackson.annotation.JsonProperty;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Null;
import lombok.Data;
import cheeko.common.utils.DateUtils;
import cheeko.common.validator.group.AddGroup;
import cheeko.common.validator.group.DefaultGroup;
import cheeko.common.validator.group.UpdateGroup;

/**
 * UserManagement
 */
@Data
@Schema(description = "UserManagement")
public class SysUserDTO implements Serializable {
    @Schema(description = "id")
    @Null(message = "{id.null}", groups = AddGroup.class)
    @NotNull(message = "{id.require}", groups = UpdateGroup.class)
    private Long id;

    @Schema(description = "Username", required = true)
    @NotBlank(message = "{sysuser.username.require}", groups = DefaultGroup.class)
    private String username;

    @Schema(description = "Password")
    @JsonProperty(access = JsonProperty.Access.WRITE_ONLY)
    @NotBlank(message = "{sysuser.password.require}", groups = AddGroup.class)
    private String password;

    @Schema(description = "Name", required = true)
    @NotBlank(message = "{sysuser.realname.require}", groups = DefaultGroup.class)
    private String realName;

    @Schema(description = "Avatar")
    private String headUrl;

    @Schema(description = "Gender   0: Male   1: Female    2: Secret", required = true)
    @Range(min = 0, max = 2, message = "{sysuser.gender.range}", groups = DefaultGroup.class)
    private Integer gender;

    @Schema(description = "Email")
    @Email(message = "{sysuser.email.error}", groups = DefaultGroup.class)
    private String email;

    @Schema(description = "Mobile Number")
    private String mobile;

    @Schema(description = "DepartmentID", required = true)
    @NotNull(message = "{sysuser.deptId.require}", groups = DefaultGroup.class)
    private Long deptId;

    @Schema(description = "Status  0：Disabled    1：Normal", required = true)
    @Range(min = 0, max = 1, message = "{sysuser.status.range}", groups = DefaultGroup.class)
    private Integer status;

    @Schema(description = "Create Time")
    @JsonProperty(access = JsonProperty.Access.READ_ONLY)
    @JsonFormat(pattern = DateUtils.DATE_TIME_PATTERN)
    private Date createDate;

    @Schema(description = "Super Admin   0: No   1: Yes")
    @JsonProperty(access = JsonProperty.Access.READ_ONLY)
    private Integer superAdmin;

    @Schema(description = "RoleIDList")
    private List<Long> roleIdList;

    @Schema(description = "Post ID List")
    private List<Long> postIdList;

    @Schema(description = "DepartmentName")
    private String deptName;

}