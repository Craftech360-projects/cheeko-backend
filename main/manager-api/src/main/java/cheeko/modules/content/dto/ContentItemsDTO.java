package cheeko.modules.content.dto;

import java.io.Serializable;
import java.util.Date;

import lombok.Data;

/**
 * Content Items DTO
 * Data Transfer Object for content items
 */
@Data
public class ContentItemsDTO implements Serializable {

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

    private static final long serialVersionUID = 1L;
}
