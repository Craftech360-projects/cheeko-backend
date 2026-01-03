package cheeko.modules.content.controller;

import java.util.List;
import java.util.Map;

import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.AllArgsConstructor;
import cheeko.common.page.PageData;
import cheeko.common.utils.Result;
import cheeko.modules.content.dto.ContentItemsDTO;
import cheeko.modules.content.dto.ContentItemsSearchDTO;
import cheeko.modules.content.service.ContentItemsService;

/**
 * Content Items REST API Controller
 */
@RestController
@RequestMapping("/content/items")
@AllArgsConstructor
@Tag(name = "Content Items", description = "Content Items CRUD Operations")
public class ContentItemsController {

    private final ContentItemsService contentItemsService;

    @PostMapping
    @Operation(summary = "Create single content item", description = "Creates a new content item")
    public Result<String> createContentItem(@RequestBody ContentItemsDTO dto) {
        String contentId = contentItemsService.createContentItem(dto);
        if (contentId == null) {
            return new Result<String>().error("Failed to create content item");
        }
        return new Result<String>().ok(contentId);
    }

    @PostMapping("/batch")
    @Operation(summary = "Batch create content items", description = "Creates multiple content items")
    public Result<Integer> batchCreateContentItems(@RequestBody List<ContentItemsDTO> dtos) {
        Integer count = contentItemsService.batchCreateContentItems(dtos);
        return new Result<Integer>().ok(count);
    }

    @GetMapping
    @Operation(summary = "Get all content items", description = "Retrieves paginated content items with optional filters")
    public Result<PageData<ContentItemsDTO>> getContentItemsList(
            @Parameter(description = "Search query") @RequestParam(required = false) String query,
            @Parameter(description = "Content type filter") @RequestParam(required = false) String contentType,
            @Parameter(description = "Category filter") @RequestParam(required = false) String category,
            @Parameter(description = "Page number") @RequestParam(defaultValue = "1") Integer page,
            @Parameter(description = "Items per page") @RequestParam(defaultValue = "20") Integer limit,
            @Parameter(description = "Sort field") @RequestParam(defaultValue = "created_at") String sortBy,
            @Parameter(description = "Sort direction") @RequestParam(defaultValue = "desc") String sortDirection) {

        ContentItemsSearchDTO searchDTO = new ContentItemsSearchDTO();
        searchDTO.setQuery(query);
        searchDTO.setContentType(contentType);
        searchDTO.setCategory(category);
        searchDTO.setPage(page);
        searchDTO.setLimit(limit);
        searchDTO.setSortBy(sortBy);
        searchDTO.setSortDirection(sortDirection);

        PageData<ContentItemsDTO> result = contentItemsService.getContentItemsList(searchDTO);
        return new Result<PageData<ContentItemsDTO>>().ok(result);
    }

    @GetMapping("/{id}")
    @Operation(summary = "Get content item by ID", description = "Retrieves a specific content item")
    public Result<ContentItemsDTO> getContentItemById(
            @Parameter(description = "Content ID", required = true) @PathVariable String id) {

        ContentItemsDTO content = contentItemsService.getContentItemById(id);
        if (content == null) {
            return new Result<ContentItemsDTO>().error("Content item not found");
        }
        return new Result<ContentItemsDTO>().ok(content);
    }

    @GetMapping("/type/{contentType}")
    @Operation(summary = "Get content items by type", description = "Retrieves content items filtered by type")
    public Result<List<ContentItemsDTO>> getContentItemsByType(
            @Parameter(description = "Content type (music/story)", required = true) @PathVariable String contentType) {

        List<ContentItemsDTO> items = contentItemsService.getContentItemsByType(contentType);
        return new Result<List<ContentItemsDTO>>().ok(items);
    }

    @GetMapping("/category/{category}")
    @Operation(summary = "Get content items by category", description = "Retrieves content items filtered by category")
    public Result<List<ContentItemsDTO>> getContentItemsByCategory(
            @Parameter(description = "Category name", required = true) @PathVariable String category) {

        List<ContentItemsDTO> items = contentItemsService.getContentItemsByCategory(category);
        return new Result<List<ContentItemsDTO>>().ok(items);
    }

    @GetMapping("/search")
    @Operation(summary = "Search content items", description = "Full-text search across content items")
    public Result<PageData<ContentItemsDTO>> searchContentItems(
            @Parameter(description = "Search query", required = true) @RequestParam String query,
            @Parameter(description = "Content type filter") @RequestParam(required = false) String contentType,
            @Parameter(description = "Page number") @RequestParam(defaultValue = "1") Integer page,
            @Parameter(description = "Items per page") @RequestParam(defaultValue = "20") Integer limit) {

        ContentItemsSearchDTO searchDTO = new ContentItemsSearchDTO();
        searchDTO.setQuery(query);
        searchDTO.setContentType(contentType);
        searchDTO.setPage(page);
        searchDTO.setLimit(limit);

        PageData<ContentItemsDTO> result = contentItemsService.searchContentItems(searchDTO);
        return new Result<PageData<ContentItemsDTO>>().ok(result);
    }

    @GetMapping("/categories")
    @Operation(summary = "Get categories by content type", description = "Retrieves available categories")
    public Result<List<String>> getCategoriesByType(
            @Parameter(description = "Content type (music/story)", required = true) @RequestParam String contentType) {

        List<String> categories = contentItemsService.getCategoriesByType(contentType);
        return new Result<List<String>>().ok(categories);
    }

    @GetMapping("/statistics")
    @Operation(summary = "Get content statistics", description = "Retrieves content counts and statistics")
    public Result<Map<String, Object>> getStatistics() {
        Map<String, Object> stats = contentItemsService.getStatistics();
        return new Result<Map<String, Object>>().ok(stats);
    }

    @PutMapping("/{id}")
    @Operation(summary = "Update content item", description = "Updates an existing content item")
    public Result<Boolean> updateContentItem(
            @Parameter(description = "Content ID", required = true) @PathVariable String id,
            @RequestBody ContentItemsDTO dto) {

        Boolean success = contentItemsService.updateContentItem(id, dto);
        if (!success) {
            return new Result<Boolean>().error("Failed to update content item");
        }
        return new Result<Boolean>().ok(true);
    }

    @PatchMapping("/{id}")
    @Operation(summary = "Partial update content item", description = "Partially updates a content item")
    public Result<Boolean> partialUpdateContentItem(
            @Parameter(description = "Content ID", required = true) @PathVariable String id,
            @RequestBody Map<String, Object> updates) {

        Boolean success = contentItemsService.partialUpdateContentItem(id, updates);
        if (!success) {
            return new Result<Boolean>().error("Failed to update content item");
        }
        return new Result<Boolean>().ok(true);
    }

    @PutMapping("/batch")
    @Operation(summary = "Batch update content items", description = "Updates multiple content items")
    public Result<Integer> batchUpdateContentItems(@RequestBody List<ContentItemsDTO> dtos) {
        Integer count = contentItemsService.batchUpdateContentItems(dtos);
        return new Result<Integer>().ok(count);
    }

    @DeleteMapping("/{id}")
    @Operation(summary = "Delete content item", description = "Deletes a content item")
    public Result<Boolean> deleteContentItem(
            @Parameter(description = "Content ID", required = true) @PathVariable String id) {

        Boolean success = contentItemsService.deleteContentItem(id);
        if (!success) {
            return new Result<Boolean>().error("Failed to delete content item");
        }
        return new Result<Boolean>().ok(true);
    }

    @DeleteMapping("/batch")
    @Operation(summary = "Batch delete content items", description = "Deletes multiple content items")
    public Result<Integer> batchDeleteContentItems(@RequestBody List<String> ids) {
        Integer count = contentItemsService.batchDeleteContentItems(ids);
        return new Result<Integer>().ok(count);
    }
}
