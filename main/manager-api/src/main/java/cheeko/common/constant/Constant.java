package cheeko.common.constant;

import lombok.Getter;

/**
 * Constant
 * Copyright (c) RenRen Open Source All rights reserved.
 * Website: https://www.renren.io
 */
public interface Constant {
    /**
     * Success
     */
    int SUCCESS = 1;
    /**
     * Failure
     */
    int FAIL = 0;
    /**
     * OK
     */
    String OK = "OK";
    /**
     * UserIdentifier
     */
    String USER_KEY = "userId";
    /**
     * MenuRootNodeIdentifier
     */
    Long MENU_ROOT = 0L;
    /**
     * DepartmentRootNodeIdentifier
     */
    Long DEPT_ROOT = 0L;
    /**
     * Data DictionaryRootNodeIdentifier
     */
    Long DICT_ROOT = 0L;
    /**
     * Ascending
     */
    String ASC = "asc";
    /**
     * Descending
     */
    String DESC = "desc";
    /**
     * Create TimeFieldName
     */
    String CREATE_DATE = "create_date";

    /**
     * Create TimeFieldName
     */
    String ID = "id";

    /**
     * DataPermissionFilter
     */
    String SQL_FILTER = "sqlFilter";

    /**
     * CurrentPage Number
     */
    String PAGE = "page";
    /**
     * Per PagedisplayRecordcount
     */
    String LIMIT = "limit";
    /**
     * Sort OrderField
     */
    String ORDER_FIELD = "orderField";
    /**
     * Sort OrderMethod
     */
    String ORDER = "order";

    /**
     * RequestHeaderAuthorizationIdentifier
     */
    String AUTHORIZATION = "Authorization";

    /**
     * ServiceServerSecret Key
     */
    String SERVER_SECRET = "server.secret";

    /**
     * websocketAddress
     */
    String SERVER_WEBSOCKET = "server.websocket";

    /**
     * otaAddress
     */
    String SERVER_OTA = "server.ota";

    /**
     * WhetherAllowUserRegister
     */
    String SERVER_ALLOW_USER_REGISTER = "server.allow_user_register";

    /**
     * Frontend URL for sending 6-digit validation code
     */
    String SERVER_FRONTED_URL = "server.fronted_url";

    /**
     * PathSeparator
     */
    String FILE_EXTENSION_SEG = ".";

    /**
     * mcpAccess PointPath
     */
    String SERVER_MCP_ENDPOINT = "server.mcp_endpoint";

    /**
     * No Memory
     */
    String MEMORY_NO_MEM = "Memory_nomem";

    enum SysBaseParam {
        /**
         * ICPRegistration Number
         */
        BEIAN_ICP_NUM("server.beian_icp_num"),
        /**
         * GARegistration Number
         */
        BEIAN_GA_NUM("server.beian_ga_num"),
        /**
         * System Name
         */
        SERVER_NAME("server.name");

        private String value;

        SysBaseParam(String value) {
            this.value = value;
        }

        public String getValue() {
            return value;
        }
    }

    /**
     * System SMS
     */
    enum SysMSMParam {
        /**
         * Alibaba CloudAuthorizationkeyID
         */
        ALIYUN_SMS_ACCESS_KEY_ID("aliyun.sms.access_key_id"),
        /**
         * Alibaba CloudAuthorizationSecret Key
         */
        ALIYUN_SMS_ACCESS_KEY_SECRET("aliyun.sms.access_key_secret"),
        /**
         * Alibaba CloudSMSSignature
         */
        ALIYUN_SMS_SIGN_NAME("aliyun.sms.sign_name"),
        /**
         * Alibaba CloudSMSTemplate
         */
        ALIYUN_SMS_SMS_CODE_TEMPLATE_CODE("aliyun.sms.sms_code_template_code"),
        /**
         * Single NumberCodeMaximumSMSSendCount
         */
        SERVER_SMS_MAX_SEND_COUNT("server.sms_max_send_count"),
        /**
         * WhetherEnableMobileRegister
         */
        SERVER_ENABLE_MOBILE_REGISTER("server.enable_mobile_register");

        private String value;

        SysMSMParam(String value) {
            this.value = value;
        }

        public String getValue() {
            return value;
        }
    }

    /**
     * DataStatus
     */
    enum DataOperation {
        /**
         * Insert
         */
        INSERT("I"),
        /**
         * HaveUpdate
         */
        UPDATE("U"),
        /**
         * HaveDelete
         */
        DELETE("D");

        private String value;

        DataOperation(String value) {
            this.value = value;
        }

        public String getValue() {
            return value;
        }
    }

    @Getter
    enum ChatHistoryConfEnum {
        IGNORE(0, "Do Not Record"),
        RECORD_TEXT(1, "Record Text"),
        RECORD_TEXT_AUDIO(2, "Record Text and Audio");

        private final int code;
        private final String name;

        ChatHistoryConfEnum(int code, String name) {
            this.code = code;
            this.name = name;
        }
    }

    /**
     * Version Number
     */
    public static final String VERSION = "0.7.5";

    /**
     * InvalidFirmwareURL
     */
    String INVALID_FIRMWARE_URL = "http://cheeko.server.com:8002/toy/otaMag/download/NOT_ACTIVATED_FIRMWARE_THIS_IS_A_INVALID_URL";

    /**
     * Dictionary Type
     */
    enum DictType {
        /**
         * MobileArea Code
         */
        MOBILE_AREA("MOBILE_AREA");

        private String value;

        DictType(String value) {
            this.value = value;
        }

        public String getValue() {
            return value;
        }
    }
}