package cheeko.common.handler;

import java.util.Date;

import org.apache.ibatis.reflection.MetaObject;
import org.springframework.stereotype.Component;

import com.baomidou.mybatisplus.core.handlers.MetaObjectHandler;

import cheeko.common.constant.Constant;
import cheeko.common.user.UserDetail;
import cheeko.modules.security.user.SecurityUser;

/**
 * Public Field Auto Fill Handler
 * Copyright (c) RenRen Open Source All rights reserved.
 * Website: https://www.renren.io
 */
@Component
public class FieldMetaObjectHandler implements MetaObjectHandler {
    private final static String CREATE_DATE = "createDate";
    private final static String CREATOR = "creator";
    private final static String UPDATE_DATE = "updateDate";
    private final static String UPDATER = "updater";

    private final static String DATA_OPERATION = "dataOperation";

    @Override
    public void insertFill(MetaObject metaObject) {
        UserDetail user = SecurityUser.getUser();
        Date date = new Date();

        // Creator
        strictInsertFill(metaObject, CREATOR, Long.class, user.getId());
        // Create Time
        strictInsertFill(metaObject, CREATE_DATE, Date.class, date);

        // Updater
        strictInsertFill(metaObject, UPDATER, Long.class, user.getId());
        // Update Time
        strictInsertFill(metaObject, UPDATE_DATE, Date.class, date);

        // DataIdentifier
        strictInsertFill(metaObject, DATA_OPERATION, String.class, Constant.DataOperation.INSERT.getValue());
    }

    @Override
    public void updateFill(MetaObject metaObject) {
        // Updater
        strictUpdateFill(metaObject, UPDATER, Long.class, SecurityUser.getUserId());
        // Update Time
        strictUpdateFill(metaObject, UPDATE_DATE, Date.class, new Date());

        // DataIdentifier
        strictInsertFill(metaObject, DATA_OPERATION, String.class, Constant.DataOperation.UPDATE.getValue());
    }
}