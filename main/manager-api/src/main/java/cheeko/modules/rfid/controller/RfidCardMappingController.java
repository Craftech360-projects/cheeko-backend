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
import cheeko.modules.rfid.dto.RfidCardMappingDTO;
import cheeko.modules.rfid.dto.RfidQuestionDTO;
import cheeko.modules.rfid.service.RfidCardMappingService;

/**
 * RFID Card Mapping Management
 */
@AllArgsConstructor
@RestController
@RequestMapping("/admin/rfid/card")
@Tag(name = "RFID Card Mapping Management")
public class RfidCardMappingController {

    private final RfidCardMappingService rfidCardMappingService;

    @GetMapping("/page")
    @Operation(summary = "Paginated card mapping query")
    @RequiresPermissions("sys:role:superAdmin")
    @Parameters({
            @Parameter(name = "rfidUid", description = "RFID UID"),
            @Parameter(name = "packCode", description = "Pack code"),
            @Parameter(name = "questionId", description = "Question ID"),
            @Parameter(name = "active", description = "Active status"),
            @Parameter(name = Constant.PAGE, description = "Current page number, starts from 1", required = true),
            @Parameter(name = Constant.LIMIT, description = "Records per page", required = true)
    })
    public Result<PageData<RfidCardMappingDTO>> page(@Parameter(hidden = true) @RequestParam Map<String, Object> params) {
        PageData<RfidCardMappingDTO> page = rfidCardMappingService.page(params);
        return new Result<PageData<RfidCardMappingDTO>>().ok(page);
    }

    @GetMapping("/list")
    @Operation(summary = "List all card mappings")
    @RequiresPermissions("sys:role:superAdmin")
    @Parameters({
            @Parameter(name = "packCode", description = "Pack code"),
            @Parameter(name = "questionId", description = "Question ID"),
            @Parameter(name = "active", description = "Active status")
    })
    public Result<List<RfidCardMappingDTO>> list(@Parameter(hidden = true) @RequestParam Map<String, Object> params) {
        List<RfidCardMappingDTO> list = rfidCardMappingService.list(params);
        return new Result<List<RfidCardMappingDTO>>().ok(list);
    }

    @GetMapping("/{id}")
    @Operation(summary = "Get card mapping by ID")
    @RequiresPermissions("sys:role:superAdmin")
    public Result<RfidCardMappingDTO> get(@PathVariable("id") Long id) {
        RfidCardMappingDTO dto = rfidCardMappingService.get(id);
        return new Result<RfidCardMappingDTO>().ok(dto);
    }

    @GetMapping("/uid/{rfidUid}")
    @Operation(summary = "Get card mapping by RFID UID")
    @RequiresPermissions("sys:role:superAdmin")
    public Result<RfidCardMappingDTO> getByRfidUid(@PathVariable("rfidUid") String rfidUid) {
        RfidCardMappingDTO dto = rfidCardMappingService.getByRfidUid(rfidUid);
        return new Result<RfidCardMappingDTO>().ok(dto);
    }

    @GetMapping("/lookup/{rfidUid}")
    @Operation(summary = "Lookup question for RFID card (device tap endpoint)")
    public Result<RfidQuestionDTO> lookupQuestion(@PathVariable("rfidUid") String rfidUid) {
        RfidQuestionDTO dto = rfidCardMappingService.getQuestionByRfidUid(rfidUid);
        return new Result<RfidQuestionDTO>().ok(dto);
    }

    @GetMapping("/pack/{packCode}")
    @Operation(summary = "Get all cards by pack code")
    @RequiresPermissions("sys:role:superAdmin")
    public Result<List<RfidCardMappingDTO>> getByPackCode(@PathVariable("packCode") String packCode) {
        List<RfidCardMappingDTO> list = rfidCardMappingService.getByPackCode(packCode);
        return new Result<List<RfidCardMappingDTO>>().ok(list);
    }

    @GetMapping("/question/{questionId}")
    @Operation(summary = "Get all cards mapped to a question")
    @RequiresPermissions("sys:role:superAdmin")
    public Result<List<RfidCardMappingDTO>> getByQuestionId(@PathVariable("questionId") Long questionId) {
        List<RfidCardMappingDTO> list = rfidCardMappingService.getByQuestionId(questionId);
        return new Result<List<RfidCardMappingDTO>>().ok(list);
    }

    @PostMapping
    @Operation(summary = "Create card mapping")
    @RequiresPermissions("sys:role:superAdmin")
    public Result<Void> save(@RequestBody RfidCardMappingDTO dto) {
        ValidatorUtils.validateEntity(dto, AddGroup.class, DefaultGroup.class);
        rfidCardMappingService.save(dto);
        return new Result<>();
    }

    @PutMapping
    @Operation(summary = "Update card mapping")
    @RequiresPermissions("sys:role:superAdmin")
    public Result<Void> update(@RequestBody RfidCardMappingDTO dto) {
        ValidatorUtils.validateEntity(dto, UpdateGroup.class, DefaultGroup.class);
        rfidCardMappingService.update(dto);
        return new Result<>();
    }

    @DeleteMapping
    @Operation(summary = "Delete card mappings")
    @RequiresPermissions("sys:role:superAdmin")
    public Result<Void> delete(@RequestBody Long[] ids) {
        rfidCardMappingService.delete(ids);
        return new Result<>();
    }
}
