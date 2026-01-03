package cheeko.modules.sys.service;

import cheeko.common.page.PageData;
import cheeko.common.service.BaseService;
import cheeko.modules.sys.dto.AdminPageUserDTO;
import cheeko.modules.sys.dto.PasswordDTO;
import cheeko.modules.sys.dto.SysUserDTO;
import cheeko.modules.sys.entity.SysUserEntity;
import cheeko.modules.sys.vo.AdminPageUserVO;

/**
 * System User
 */
public interface SysUserService extends BaseService<SysUserEntity> {

    SysUserDTO getByUsername(String username);

    SysUserDTO getByUserId(Long userId);

    void save(SysUserDTO dto);

    /**
     * Delete specified user and associated data (devices and agents)
     * 
     * @param ids
     */
    void deleteById(Long ids);

    /**
     * Validate and update password
     * 
     * @param userId      User ID
     * @param passwordDTO Password validation parameters
     */
    void changePassword(Long userId, PasswordDTO passwordDTO);

    /**
     * Update password directly without validation
     * 
     * @param userId   User ID
     * @param password Password
     */
    void changePasswordDirectly(Long userId, String password);

    /**
     * Reset password
     * 
     * @param userId User ID
     * @return Randomly generated password that meets standards
     */
    String resetPassword(Long userId);

    /**
     * Admin pagination user information
     * 
     * @param dto Pagination query parameters
     * @return User list pagination data
     */
    PageData<AdminPageUserVO> page(AdminPageUserDTO dto);

    /**
     * Batch update user status
     * 
     * @param status  User status
     * @param userIds User ID array
     */
    void changeStatus(Integer status, String[] userIds);

    /**
     * Get whether user registration is allowed
     * 
     * @return Whether user registration is allowed
     */
    boolean getAllowUserRegister();
}
