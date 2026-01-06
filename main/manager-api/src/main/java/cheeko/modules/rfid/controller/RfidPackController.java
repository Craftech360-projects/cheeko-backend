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
import cheeko.modules.rfid.dto.RfidPackDTO;
import cheeko.modules.rfid.service.RfidPackService;

/**
 * RFID Pack Management
 */
@AllArgsConstructor
@RestController
@RequestMapping("/admin/rfid/pack")
@Tag(name = "RFID Pack Management")
public class RfidPackController {

    private final RfidPackService rfidPackService;

    @GetMapping("/page")
    @Operation(summary = "Paginated pack query")
    @RequiresPermissions("sys:role:superAdmin")
    @Parameters({
            @Parameter(name = "packCode", description = "Pack code"),
            @Parameter(name = "name", description = "Pack name"),
            @Parameter(name = "active", description = "Active status"),
            @Parameter(name = Constant.PAGE, description = "Current page number, starts from 1", required = true),
            @Parameter(name = Constant.LIMIT, description = "Records per page", required = true)
    })
    public Result<PageData<RfidPackDTO>> page(@Parameter(hidden = true) @RequestParam Map<String, Object> params) {
        PageData<RfidPackDTO> page = rfidPackService.page(params);
        return new Result<PageData<RfidPackDTO>>().ok(page);
    }

    @GetMapping("/list")
    @Operation(summary = "List all packs")
    @RequiresPermissions("sys:role:superAdmin")
    public Result<List<RfidPackDTO>> list(@Parameter(hidden = true) @RequestParam Map<String, Object> params) {
        List<RfidPackDTO> list = rfidPackService.list(params);
        return new Result<List<RfidPackDTO>>().ok(list);
    }

    @GetMapping("/active")
    @Operation(summary = "List all active packs")
    public Result<List<RfidPackDTO>> getAllActive() {
        List<RfidPackDTO> list = rfidPackService.getAllActive();
        return new Result<List<RfidPackDTO>>().ok(list);
    }

    @GetMapping("/{id}")
    @Operation(summary = "Get pack by ID")
    @RequiresPermissions("sys:role:superAdmin")
    public Result<RfidPackDTO> get(@PathVariable("id") Long id) {
        RfidPackDTO dto = rfidPackService.get(id);
        return new Result<RfidPackDTO>().ok(dto);
    }

    @GetMapping("/code/{packCode}")
    @Operation(summary = "Get pack by code")
    @RequiresPermissions("sys:role:superAdmin")
    public Result<RfidPackDTO> getByPackCode(@PathVariable("packCode") String packCode) {
        RfidPackDTO dto = rfidPackService.getByPackCode(packCode);
        return new Result<RfidPackDTO>().ok(dto);
    }

    @GetMapping("/age/{age}")
    @Operation(summary = "Get packs suitable for age")
    public Result<List<RfidPackDTO>> getByAge(@PathVariable("age") Integer age) {
        List<RfidPackDTO> list = rfidPackService.getByAge(age);
        return new Result<List<RfidPackDTO>>().ok(list);
    }

    @PostMapping
    @Operation(summary = "Create pack")
    @RequiresPermissions("sys:role:superAdmin")
    public Result<Void> save(@RequestBody RfidPackDTO dto) {
        ValidatorUtils.validateEntity(dto, AddGroup.class, DefaultGroup.class);
        rfidPackService.save(dto);
        return new Result<>();
    }

    @PutMapping
    @Operation(summary = "Update pack")
    @RequiresPermissions("sys:role:superAdmin")
    public Result<Void> update(@RequestBody RfidPackDTO dto) {
        ValidatorUtils.validateEntity(dto, UpdateGroup.class, DefaultGroup.class);
        rfidPackService.update(dto);
        return new Result<>();
    }

    @DeleteMapping
    @Operation(summary = "Delete packs")
    @RequiresPermissions("sys:role:superAdmin")
    public Result<Void> delete(@RequestBody Long[] ids) {
        rfidPackService.delete(ids);
        return new Result<>();
    }

    @PostMapping("/delete")
    @Operation(summary = "Delete packs (POST)")
    @RequiresPermissions("sys:role:superAdmin")
    public Result<Void> deletePost(@RequestBody Long[] ids) {
        rfidPackService.delete(ids);
        return new Result<>();
    }
}
