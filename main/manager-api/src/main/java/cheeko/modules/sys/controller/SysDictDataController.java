package cheeko.modules.sys.controller;

import java.util.List;
import java.util.Map;

import org.apache.commons.lang3.StringUtils;
import org.apache.shiro.authz.annotation.RequiresPermissions;
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
import cheeko.modules.sys.dto.SysDictDataDTO;
import cheeko.modules.sys.service.SysDictDataService;
import cheeko.modules.sys.vo.SysDictDataItem;
import cheeko.modules.sys.vo.SysDictDataVO;

/**
 * Dictionary Data Management
 *
 * @author czc
 * @since 2025-04-30
 */
@AllArgsConstructor
@RestController
@RequestMapping("/admin/dict/data")
@Tag(name = "Dictionary Data Management")
public class SysDictDataController {
    private final SysDictDataService sysDictDataService;

    @GetMapping("/page")
    @Operation(summary = "Paginated dictionary data query")
    @RequiresPermissions("sys:role:superAdmin")
    @Parameters({ @Parameter(name = "dictTypeId", description = "Dictionary type ID", required = true),
            @Parameter(name = "dictLabel", description = "Data label"), @Parameter(name = "dictValue", description = "Data value"),
            @Parameter(name = Constant.PAGE, description = "Current page number, starts from 1", required = true),
            @Parameter(name = Constant.LIMIT, description = "Records per page", required = true) })
    public Result<PageData<SysDictDataVO>> page(@Parameter(hidden = true) @RequestParam Map<String, Object> params) {
        ValidatorUtils.validateEntity(params);
        // Force validate dictTypeId exists
        if (!params.containsKey("dictTypeId") || StringUtils.isEmpty(String.valueOf(params.get("dictTypeId")))) {
            return new Result<PageData<SysDictDataVO>>().error("dictTypeId cannot be empty");
        }

        PageData<SysDictDataVO> page = sysDictDataService.page(params);
        return new Result<PageData<SysDictDataVO>>().ok(page);
    }

    @GetMapping("/{id}")
    @Operation(summary = "Get dictionary data details")
    @RequiresPermissions("sys:role:superAdmin")
    public Result<SysDictDataVO> get(@PathVariable("id") Long id) {
        SysDictDataVO vo = sysDictDataService.get(id);
        return new Result<SysDictDataVO>().ok(vo);
    }

    @PostMapping("/save")
    @Operation(summary = "Add dictionary data")
    @RequiresPermissions("sys:role:superAdmin")
    public Result<Void> save(@RequestBody SysDictDataDTO dto) {
        ValidatorUtils.validateEntity(dto);
        sysDictDataService.save(dto);
        return new Result<>();
    }

    @PutMapping("/update")
    @Operation(summary = "Modify dictionary data")
    @RequiresPermissions("sys:role:superAdmin")
    public Result<Void> update(@RequestBody SysDictDataDTO dto) {
        ValidatorUtils.validateEntity(dto);
        sysDictDataService.update(dto);
        return new Result<>();
    }

    @PostMapping("/delete")
    @Operation(summary = "Delete dictionary data")
    @RequiresPermissions("sys:role:superAdmin")
    @Parameter(name = "ids", description = "ID array", required = true)
    public Result<Void> delete(@RequestBody Long[] ids) {
        sysDictDataService.delete(ids);
        return new Result<>();
    }

    @GetMapping("/type/{dictType}")
    @Operation(summary = "Get dictionary data list")
    @RequiresPermissions("sys:role:normal")
    public Result<List<SysDictDataItem>> getDictDataByType(@PathVariable("dictType") String dictType) {
        List<SysDictDataItem> list = sysDictDataService.getDictDataByType(dictType);
        return new Result<List<SysDictDataItem>>().ok(list);
    }

}
