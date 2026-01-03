package cheeko.common.annotation;

import java.lang.annotation.Documented;
import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * DataFilterAnnotation
 * Copyright (c) RenRen Open Source All rights reserved.
 * Website: https://www.renren.io
 */
@Target(ElementType.METHOD)
@Retention(RetentionPolicy.RUNTIME)
@Documented
public @interface DataFilter {
    /**
     * Table alias name
     */
    String tableAlias() default "";

    /**
     * UserID
     */
    String userId() default "creator";

    /**
     * DepartmentID
     */
    String deptId() default "dept_id";

}