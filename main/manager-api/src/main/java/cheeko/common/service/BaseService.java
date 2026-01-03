package cheeko.common.service;

import java.io.Serializable;
import java.util.Collection;

import com.baomidou.mybatisplus.core.conditions.Wrapper;

/**
 * Basic Service Interface, all Service Interfaces should inherit from this
 * Copyright (c) RenRen Open Source All rights reserved.
 * Website: https://www.renren.io
 */
public interface BaseService<T> {
    Class<T> currentModelClass();

    /**
     * <p>
     * Insert a record (select fields, strategy insert)
     * </p>
     *
     * @param entity Entity object
     */
    boolean insert(T entity);

    /**
     * <p>
     * Insert (batch), this method does not support Oracle, SQL Server
     * </p>
     *
     * @param entityList Entity object collection
     */
    boolean insertBatch(Collection<T> entityList);

    /**
     * <p>
     * Insert (batch), this method does not support Oracle, SQL Server
     * </p>
     *
     * @param entityList Entity object collection
     * @param batchSize  Insert batch quantity
     */
    boolean insertBatch(Collection<T> entityList, int batchSize);

    /**
     * <p>
     * Update by ID
     * </p>
     *
     * @param entity Entity object
     */
    boolean updateById(T entity);

    /**
     * <p>
     * Update record by whereEntity condition
     * </p>
     *
     * @param entity        Entity object
     * @param updateWrapper Entity object wrapper operation class
     *                      {@link com.baomidou.mybatisplus.core.conditions.update.UpdateWrapper}
     */
    boolean update(T entity, Wrapper<T> updateWrapper);

    /**
     * <p>
     * Batch update by ID
     * </p>
     *
     * @param entityList Entity object collection
     */
    boolean updateBatchById(Collection<T> entityList);

    /**
     * <p>
     * Batch update by ID
     * </p>
     *
     * @param entityList Entity object collection
     * @param batchSize  Update batch quantity
     */
    boolean updateBatchById(Collection<T> entityList, int batchSize);

    /**
     * <p>
     * Query by ID
     * </p>
     *
     * @param id Primary key ID
     */
    T selectById(Serializable id);

    /**
     * <p>
     * Delete by ID
     * </p>
     *
     * @param id Primary key ID
     */
    boolean deleteById(Serializable id);

    /**
     * <p>
     * Delete (batch delete by ID)
     * </p>
     *
     * @param idList Primary key ID list
     */
    boolean deleteBatchIds(Collection<? extends Serializable> idList);
}