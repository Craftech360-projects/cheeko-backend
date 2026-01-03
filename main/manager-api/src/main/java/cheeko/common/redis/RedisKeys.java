package cheeko.common.redis;

/**
 * Redis Key ConstantClass
 * Copyright (c) RenRen Open Source All rights reserved.
 * Website: https://www.renren.io
 */
public class RedisKeys {
    /**
     * System ParameterKey
     */
    public static String getSysParamsKey() {
        return "sys:params";
    }

    /**
     * ValidateCodeKey
     */
    public static String getCaptchaKey(String uuid) {
        return "sys:captcha:" + uuid;
    }

    /**
     * Unregistered Device Validation Code Key
     */
    public static String getDeviceCaptchaKey(String captcha) {
        return "sys:device:captcha:" + captcha;
    }

    /**
     * Userids Key
     */
    public static String getUserIdKey(Long userid) {
        return "sys:username:id:" + userid;
    }

    /**
     * ModelNames Key
     */
    public static String getModelNameById(String id) {
        return "model:name:" + id;
    }

    /**
     * ModelConfigurations Key
     */
    public static String getModelConfigById(String id) {
        return "model:data:" + id;
    }

    /**
     * GetTimbreNameCachekey
     */
    public static String getTimbreNameById(String id) {
        return "timbre:name:" + id;
    }

    /**
     * GetDeviceQuantityCachekey
     */
    public static String getAgentDeviceCountById(String id) {
        return "agent:device:count:" + id;
    }

    /**
     * GetAgentLastConnectionTimeCachekey
     */
    public static String getAgentDeviceLastConnectedAtById(String id) {
        return "agent:device:lastConnected:" + id;
    }

    /**
     * GetSystemConfigurationCachekey
     */
    public static String getServerConfigKey() {
        return "server:config";
    }

    /**
     * GetTimbreDetailsCachekey
     */
    public static String getTimbreDetailsKey(String id) {
        return "timbre:details:" + id;
    }

    /**
     * Get Version Number Key
     */
    public static String getVersionKey() {
        return "sys:version";
    }

    /**
     * OTAFirmwareIDs Key
     */
    public static String getOtaIdKey(String uuid) {
        return "ota:id:" + uuid;
    }

    /**
     * OTA Firmware Download Count Key
     */
    public static String getOtaDownloadCountKey(String uuid) {
        return "ota:download:count:" + uuid;
    }

    /**
     * Get Dictionary Data Cache Key
     */
    public static String getDictDataByTypeKey(String dictType) {
        return "sys:dict:data:" + dictType;
    }

    /**
     * GetAgentAudioIDs Cachekey
     */
    public static String getAgentAudioIdKey(String uuid) {
        return "agent:audio:id:" + uuid;
    }

    /**
     * GetSMSValidateCodes Cachekey
     */
    public static String getSMSValidateCodeKey(String phone) {
        return "sms:Validate:Code:" + phone;
    }

    /**
     * GetSMSValidateCodeLastSendTimes Cachekey
     */
    public static String getSMSLastSendTimeKey(String phone) {
        return "sms:Validate:Code:" + phone + ":last_send_time";
    }

    /**
     * Get SMS Validation Code Today Send Count Cache Key
     */
    public static String getSMSTodayCountKey(String phone) {
        return "sms:Validate:Code:" + phone + ":today_count";
    }

}
