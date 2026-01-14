package cheeko.modules.rfid.controller;

import java.util.List;
import java.util.Map;

import org.apache.shiro.authz.annotation.RequiresPermissions;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.Parameters;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.AllArgsConstructor;
import cheeko.common.constant.Constant;
import cheeko.common.page.PageData;
import cheeko.common.utils.Result;
import cheeko.common.validator.ValidatorUtils;
import cheeko.common.validator.group.AddGroup;
import cheeko.common.validator.group.DefaultGroup;
import cheeko.common.validator.group.UpdateGroup;
import cheeko.modules.rfid.dto.RfidQuestionDTO;
import cheeko.modules.rfid.service.RfidQuestionService;

/**
 * RFID Question Template Management
 */
@AllArgsConstructor
@RestController
@RequestMapping("/admin/rfid/question")
@Tag(name = "RFID Question Template Management")
public class RfidQuestionController {

    private final RfidQuestionService rfidQuestionService;

    @GetMapping("/page")
    @Operation(summary = "Paginated question query")
    @RequiresPermissions("sys:role:superAdmin")
    @Parameters({
            @Parameter(name = "code", description = "Question code"),
            @Parameter(name = "category", description = "Category"),
            @Parameter(name = "language", description = "Language code"),
            @Parameter(name = "active", description = "Active status"),
            @Parameter(name = Constant.PAGE, description = "Current page number, starts from 1", required = true),
            @Parameter(name = Constant.LIMIT, description = "Records per page", required = true)
    })
    public Result<PageData<RfidQuestionDTO>> page(@Parameter(hidden = true) @RequestParam Map<String, Object> params) {
        PageData<RfidQuestionDTO> page = rfidQuestionService.page(params);
        return new Result<PageData<RfidQuestionDTO>>().ok(page);
    }

    @GetMapping("/list")
    @Operation(summary = "List all questions")
    @RequiresPermissions("sys:role:superAdmin")
    @Parameters({
            @Parameter(name = "category", description = "Category"),
            @Parameter(name = "language", description = "Language code"),
            @Parameter(name = "active", description = "Active status")
    })
    public Result<List<RfidQuestionDTO>> list(@Parameter(hidden = true) @RequestParam Map<String, Object> params) {
        List<RfidQuestionDTO> list = rfidQuestionService.list(params);
        return new Result<List<RfidQuestionDTO>>().ok(list);
    }

    @GetMapping("/{id}")
    @Operation(summary = "Get question by ID")
    @RequiresPermissions("sys:role:superAdmin")
    public Result<RfidQuestionDTO> get(@PathVariable("id") Long id) {
        RfidQuestionDTO dto = rfidQuestionService.get(id);
        return new Result<RfidQuestionDTO>().ok(dto);
    }

    @GetMapping("/code/{code}")
    @Operation(summary = "Get question by code")
    @RequiresPermissions("sys:role:superAdmin")
    public Result<RfidQuestionDTO> getByCode(@PathVariable("code") String code) {
        RfidQuestionDTO dto = rfidQuestionService.getByCode(code);
        return new Result<RfidQuestionDTO>().ok(dto);
    }

    @GetMapping("/category/{category}")
    @Operation(summary = "Get active questions by category")
    @RequiresPermissions("sys:role:superAdmin")
    public Result<List<RfidQuestionDTO>> getByCategory(@PathVariable("category") String category) {
        List<RfidQuestionDTO> list = rfidQuestionService.getActiveByCategory(category);
        return new Result<List<RfidQuestionDTO>>().ok(list);
    }

    @GetMapping("/language/{language}")
    @Operation(summary = "Get active questions by language")
    @RequiresPermissions("sys:role:superAdmin")
    public Result<List<RfidQuestionDTO>> getByLanguage(@PathVariable("language") String language) {
        List<RfidQuestionDTO> list = rfidQuestionService.getActiveByLanguage(language);
        return new Result<List<RfidQuestionDTO>>().ok(list);
    }

    @PostMapping
    @Operation(summary = "Create question")
    @RequiresPermissions("sys:role:superAdmin")
    public Result<Void> save(@RequestBody RfidQuestionDTO dto) {
        ValidatorUtils.validateEntity(dto, AddGroup.class, DefaultGroup.class);
        rfidQuestionService.save(dto);
        return new Result<>();
    }

    @PutMapping
    @Operation(summary = "Update question")
    @RequiresPermissions("sys:role:superAdmin")
    public Result<Void> update(@RequestBody RfidQuestionDTO dto) {
        ValidatorUtils.validateEntity(dto, UpdateGroup.class, DefaultGroup.class);
        rfidQuestionService.update(dto);
        return new Result<>();
    }

    @PutMapping("/{id}/cached-audio")
    @Operation(summary = "Update cached audio URL for question")
    public Result<Void> updateCachedAudioUrl(
            @PathVariable("id") Long id,
            @RequestBody Map<String, String> body) {
        String cachedAudioUrl = body.get("cachedAudioUrl");
        rfidQuestionService.updateCachedAudioUrl(id, cachedAudioUrl);
        return new Result<>();
    }

    @DeleteMapping
    @Operation(summary = "Delete questions")
    @RequiresPermissions("sys:role:superAdmin")
    public Result<Void> delete(@RequestBody Long[] ids) {
        rfidQuestionService.delete(ids);
        return new Result<>();
    }

    @PostMapping("/delete")
    @Operation(summary = "Delete questions (POST)")
    @RequiresPermissions("sys:role:superAdmin")
    public Result<Void> deletePost(@RequestBody Long[] ids) {
        rfidQuestionService.delete(ids);
        return new Result<>();
    }
}
