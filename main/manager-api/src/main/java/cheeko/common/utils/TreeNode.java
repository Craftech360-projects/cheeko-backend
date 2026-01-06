package cheeko.common.utils;

import java.io.Serializable;
import java.util.ArrayList;
import java.util.List;

import lombok.Data;

/**
 * Tree node, all classes that need to implement tree nodes must inherit this class
 * Copyright (c) RenRen Open Source All rights reserved.
 * Website: https://www.renren.io
 */
@Data
public class TreeNode<T> implements Serializable {

    /**
     * Primary Key
     */
    private Long id;
    /**
     * ParentID
     */
    private Long pid;
    /**
     * Child NodesList
     */
    private List<T> children = new ArrayList<>();

}