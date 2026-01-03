package cheeko.modules.content.dto;

import java.io.Serializable;

import lombok.Data;

/**
 * Content Items Search DTO
 * Search and filter parameters for content items
 */
@Data
public class ContentItemsSearchDTO implements Serializable {

    private String query;

    private String contentType;

    private String category;

    private Integer page = 1;

    private Integer limit = 20;

    private String sortBy = "created_at";

    private String sortDirection = "desc";

    private static final long serialVersionUID = 1L;
}
