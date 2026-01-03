package cheeko.modules.sys.service;


import java.util.function.Consumer;

/**
 * Define a system user utility class to avoid circular dependency with user module
 * For example, if User and Device depend on each other, User needs to get all devices, and Device needs to get username for each device
 * @author zjy
 * @since 2025-4-2
 */
public interface SysUserUtilService {
    /**
     * Assign username
     * @param userId User ID
     * @param setter Assignment method
     */
    void assignUsername( Long userId, Consumer<String> setter);
}
