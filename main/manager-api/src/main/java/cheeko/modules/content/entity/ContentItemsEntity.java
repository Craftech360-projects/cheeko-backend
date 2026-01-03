package cheeko.modules.content.entity;

import java.io.Serializable;
import java.util.Date;

import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;

import lombok.Data;

/**
 * Content Items Entity
 * Represents music and story content items
 *
 * @TableName content_items
 */
@TableName(value = "content_items")
@Data
public class ContentItemsEntity implements Serializable {

    @TableId
    private String id;

    private String title;

    private String romanized;

    private String filename;

    private String contentType;

    private String category;

    private String alternatives;

    private String fileUrl;

    private Integer durationSeconds;

    private Date createdAt;

    private Date updatedAt;

    private String thumbnailUrl;

    @TableField(exist = false)
    private static final long serialVersionUID = 1L;
}
