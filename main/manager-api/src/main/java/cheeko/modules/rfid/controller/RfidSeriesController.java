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
import cheeko.modules.rfid.dto.RfidSeriesDTO;
import cheeko.modules.rfid.service.RfidSeriesService;

/**
 * RFID Series Management
 */
@AllArgsConstructor
@RestController
@RequestMapping("/admin/rfid/series")
@Tag(name = "RFID Series/Range Management")
public class RfidSeriesController {

    private final RfidSeriesService rfidSeriesService;

    @GetMapping("/page")
    @Operation(summary = "Paginated series query")
    @RequiresPermissions("sys:role:superAdmin")
    @Parameters({
            @Parameter(name = "packId", description = "Pack ID"),
            @Parameter(name = "questionId", description = "Question ID"),
            @Parameter(name = "active", description = "Active status"),
            @Parameter(name = Constant.PAGE, description = "Current page number, starts from 1", required = true),
            @Parameter(name = Constant.LIMIT, description = "Records per page", required = true)
    })
    public Result<PageData<RfidSeriesDTO>> page(@Parameter(hidden = true) @RequestParam Map<String, Object> params) {
        PageData<RfidSeriesDTO> page = rfidSeriesService.page(params);
        return new Result<PageData<RfidSeriesDTO>>().ok(page);
    }

    @GetMapping("/list")
    @Operation(summary = "List all series")
    @RequiresPermissions("sys:role:superAdmin")
    public Result<List<RfidSeriesDTO>> list(@Parameter(hidden = true) @RequestParam Map<String, Object> params) {
        List<RfidSeriesDTO> list = rfidSeriesService.list(params);
        return new Result<List<RfidSeriesDTO>>().ok(list);
    }

    @GetMapping("/active")
    @Operation(summary = "List all active series")
    @RequiresPermissions("sys:role:superAdmin")
    public Result<List<RfidSeriesDTO>> getAllActive() {
        List<RfidSeriesDTO> list = rfidSeriesService.getAllActive();
        return new Result<List<RfidSeriesDTO>>().ok(list);
    }

    @GetMapping("/{id}")
    @Operation(summary = "Get series by ID")
    @RequiresPermissions("sys:role:superAdmin")
    public Result<RfidSeriesDTO> get(@PathVariable("id") Long id) {
        RfidSeriesDTO dto = rfidSeriesService.get(id);
        return new Result<RfidSeriesDTO>().ok(dto);
    }

    @GetMapping("/lookup/{uid}")
    @Operation(summary = "Lookup question by UID range (device tap endpoint)")
    public Result<RfidQuestionDTO> lookupByRange(@PathVariable("uid") String uid) {
        RfidQuestionDTO dto = rfidSeriesService.getQuestionByUidRange(uid);
        return new Result<RfidQuestionDTO>().ok(dto);
    }

    @GetMapping("/find/{uid}")
    @Operation(summary = "Find all series containing UID")
    @RequiresPermissions("sys:role:superAdmin")
    public Result<List<RfidSeriesDTO>> findByUid(@PathVariable("uid") String uid) {
        List<RfidSeriesDTO> list = rfidSeriesService.findSeriesContainingUid(uid);
        return new Result<List<RfidSeriesDTO>>().ok(list);
    }

    @GetMapping("/pack/{packId}")
    @Operation(summary = "Get series by pack ID")
    @RequiresPermissions("sys:role:superAdmin")
    public Result<List<RfidSeriesDTO>> getByPackId(@PathVariable("packId") Long packId) {
        List<RfidSeriesDTO> list = rfidSeriesService.getByPackId(packId);
        return new Result<List<RfidSeriesDTO>>().ok(list);
    }

    @GetMapping("/question/{questionId}")
    @Operation(summary = "Get series by question ID")
    @RequiresPermissions("sys:role:superAdmin")
    public Result<List<RfidSeriesDTO>> getByQuestionId(@PathVariable("questionId") Long questionId) {
        List<RfidSeriesDTO> list = rfidSeriesService.getByQuestionId(questionId);
        return new Result<List<RfidSeriesDTO>>().ok(list);
    }

    @PostMapping
    @Operation(summary = "Create series")
    @RequiresPermissions("sys:role:superAdmin")
    public Result<Void> save(@RequestBody RfidSeriesDTO dto) {
        ValidatorUtils.validateEntity(dto, AddGroup.class, DefaultGroup.class);
        rfidSeriesService.save(dto);
        return new Result<>();
    }

    @PutMapping
    @Operation(summary = "Update series")
    @RequiresPermissions("sys:role:superAdmin")
    public Result<Void> update(@RequestBody RfidSeriesDTO dto) {
        ValidatorUtils.validateEntity(dto, UpdateGroup.class, DefaultGroup.class);
        rfidSeriesService.update(dto);
        return new Result<>();
    }

    @DeleteMapping
    @Operation(summary = "Delete series")
    @RequiresPermissions("sys:role:superAdmin")
    public Result<Void> delete(@RequestBody Long[] ids) {
        rfidSeriesService.delete(ids);
        return new Result<>();
    }

    @PostMapping("/delete")
    @Operation(summary = "Delete series (POST)")
    @RequiresPermissions("sys:role:superAdmin")
    public Result<Void> deletePost(@RequestBody Long[] ids) {
        rfidSeriesService.delete(ids);
        return new Result<>();
    }
}
