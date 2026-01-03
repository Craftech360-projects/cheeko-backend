package cheeko.modules.sys.controller;

import java.util.Map;

import org.apache.commons.lang3.StringUtils;
import org.apache.shiro.authz.annotation.RequiresPermissions;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.client.RestTemplate;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.Parameters;
import io.swagger.v3.oas.annotations.enums.ParameterIn;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.AllArgsConstructor;
import cheeko.common.annotation.LogOperation;
import cheeko.common.constant.Constant;
import cheeko.common.exception.RenException;
import cheeko.common.page.PageData;
import cheeko.common.utils.Result;
import cheeko.common.validator.AssertUtils;
import cheeko.common.validator.ValidatorUtils;
import cheeko.common.validator.group.AddGroup;
import cheeko.common.validator.group.DefaultGroup;
import cheeko.common.validator.group.UpdateGroup;
import cheeko.modules.config.service.ConfigService;
import cheeko.modules.sys.dto.SysParamsDTO;
import cheeko.modules.sys.service.SysParamsService;
import cheeko.modules.sys.utils.WebSocketValidator;

/**
 * Parameter Management
 *
 * @author Mark sunlightcs@gmail.com
 * @since 1.0.0
 */
@RestController
@RequestMapping("admin/params")
@Tag(name = "Parameter Management")
@AllArgsConstructor
public class SysParamsController {
    private final SysParamsService sysParamsService;
    private final ConfigService configService;
    private final RestTemplate restTemplate;

    @GetMapping("page")
    @Operation(summary = "Pagination")
    @Parameters({
            @Parameter(name = Constant.PAGE, description = "Current page number, starts from 1", in = ParameterIn.QUERY, required = true, ref = "int"),
            @Parameter(name = Constant.LIMIT, description = "Records per page", in = ParameterIn.QUERY, required = true, ref = "int"),
            @Parameter(name = Constant.ORDER_FIELD, description = "Sort field", in = ParameterIn.QUERY, ref = "String"),
            @Parameter(name = Constant.ORDER, description = "Sort order, options (asc, desc)", in = ParameterIn.QUERY, ref = "String"),
            @Parameter(name = "paramCode", description = "Parameter code or parameter remark", in = ParameterIn.QUERY, ref = "String")
    })
    @RequiresPermissions("sys:role:superAdmin")
    public Result<PageData<SysParamsDTO>> page(@Parameter(hidden = true) @RequestParam Map<String, Object> params) {
        PageData<SysParamsDTO> page = sysParamsService.page(params);

        return new Result<PageData<SysParamsDTO>>().ok(page);
    }

    @GetMapping("{id}")
    @Operation(summary = "Information")
    @RequiresPermissions("sys:role:superAdmin")
    public Result<SysParamsDTO> get(@PathVariable("id") Long id) {
        SysParamsDTO data = sysParamsService.get(id);

        return new Result<SysParamsDTO>().ok(data);
    }

    @PostMapping
    @Operation(summary = "Save")
    @LogOperation("Save")
    @RequiresPermissions("sys:role:superAdmin")
    public Result<Void> save(@RequestBody SysParamsDTO dto) {
        // Validate data
        ValidatorUtils.validateEntity(dto, AddGroup.class, DefaultGroup.class);

        sysParamsService.save(dto);
        configService.getConfig(false);
        return new Result<Void>();
    }

    @PutMapping
    @Operation(summary = "Modify")
    @LogOperation("Update")
    @RequiresPermissions("sys:role:superAdmin")
    public Result<Void> update(@RequestBody SysParamsDTO dto,
                              @RequestParam(value = "skipValidation", required = false, defaultValue = "false") Boolean skipValidation) {
        // Debug logging
        System.out.println("🔧 UPDATE PARAM - paramCode: " + dto.getParamCode() + ", skipValidation: " + skipValidation);

        // Validate data
        ValidatorUtils.validateEntity(dto, UpdateGroup.class, DefaultGroup.class);

        // ValidateWebSocketAddressList (CanSelectSkip)
        validateWebSocketUrls(dto.getParamCode(), dto.getParamValue(), skipValidation);

        // ValidateOTAAddress
        validateOtaUrl(dto.getParamCode(), dto.getParamValue());

        // ValidateMCPAddress
        validateMcpUrl(dto.getParamCode(), dto.getParamValue());

        sysParamsService.update(dto);
        configService.getConfig(false);
        return new Result<Void>();
    }

    /**
     * Validate WebSocket address list
     *
     * @param paramCode Parameter code
     * @param urls WebSocket address list, separated by semicolons
     * @param skipValidation Whether to skip connection test validation
     * @return Validation result
     */
    private void validateWebSocketUrls(String paramCode, String urls, Boolean skipValidation) {
        if (!paramCode.equals(Constant.SERVER_WEBSOCKET)) {
            return;
        }

        System.out.println("🔧 WEBSOCKET VALIDATION - paramCode: " + paramCode + ", skipValidation: " + skipValidation);

        String[] wsUrls = urls.split("\\;");
        if (wsUrls.length == 0) {
            throw new RenException("WebSocket address list cannot be empty");
        }
        for (String url : wsUrls) {
            if (StringUtils.isNotBlank(url)) {
                // Check if contains localhost or 127.0.0.1
                if (url.contains("localhost") || url.contains("127.0.0.1")) {
                    throw new RenException("WebSocket address cannot use localhost or 127.0.0.1");
                }

                // Validate WebSocket address format
                if (!WebSocketValidator.validateUrlFormat(url)) {
                    throw new RenException("WebSocket address format incorrect: " + url);
                }

                // Test WebSocket connection (can be skipped)
                if (!skipValidation && !WebSocketValidator.testConnection(url)) {
                    throw new RenException("WebSocket connection test failed: " + url);
                } else if (skipValidation) {
                    System.out.println("🚀 SKIPPING WebSocket connection test for: " + url);
                }
            }
        }
    }

    @PostMapping("/delete")
    @Operation(summary = "Delete")
    @LogOperation("Delete")
    @RequiresPermissions("sys:role:superAdmin")
    public Result<Void> delete(@RequestBody String[] ids) {
        // Validate data
        AssertUtils.isArrayEmpty(ids, "id");

        sysParamsService.delete(ids);
        configService.getConfig(false);
        return new Result<Void>();
    }

    /**
     * Validate OTA address
     */
    private void validateOtaUrl(String paramCode, String url) {
        if (!paramCode.equals(Constant.SERVER_OTA)) {
            return;
        }
        if (StringUtils.isBlank(url) || url.equals("null")) {
            throw new RenException("OTA address cannot be empty");
        }

        // Check if contains localhost or 127.0.0.1
        if (url.contains("localhost") || url.contains("127.0.0.1")) {
            throw new RenException("OTA address cannot use localhost or 127.0.0.1");
        }

        // Validate URL format
        if (!url.toLowerCase().startsWith("http")) {
            throw new RenException("OTA address must start with http or https");
        }
        if (!url.endsWith("/ota/")) {
            throw new RenException("OTA address must end with /ota/");
        }

        try {
            // Send GET request
            ResponseEntity<String> response = restTemplate.getForEntity(url, String.class);
            if (response.getStatusCode() != HttpStatus.OK) {
                throw new RenException("OTA API access failed, status code: " + response.getStatusCode());
            }
            // Check if response content contains OTA related information
            String body = response.getBody();
            if (body == null || !body.contains("OTA")) {
                throw new RenException("OTA API response format incorrect, may not be a valid OTA API");
            }
        } catch (Exception e) {
            throw new RenException("OTA API validation failed: " + e.getMessage());
        }
    }

    private void validateMcpUrl(String paramCode, String url) {
        if (!paramCode.equals(Constant.SERVER_MCP_ENDPOINT)) {
            return;
        }
        if (StringUtils.isBlank(url) || url.equals("null")) {
            throw new RenException("MCP address cannot be empty");
        }
        if (url.contains("localhost") || url.contains("127.0.0.1")) {
            throw new RenException("MCP address cannot use localhost or 127.0.0.1");
        }
        if (!url.toLowerCase().contains("key")) {
            throw new RenException("Invalid MCP address");
        }

        try {
            // Send GET request
            ResponseEntity<String> response = restTemplate.getForEntity(url, String.class);
            if (response.getStatusCode() != HttpStatus.OK) {
                throw new RenException("MCP API access failed, status code: " + response.getStatusCode());
            }
            // Check if response contains MCP related info
            String body = response.getBody();
            if (body == null || !body.contains("success")) {
                throw new RenException("MCP API response format incorrect, may not be a valid MCP API");
            }
        } catch (Exception e) {
            throw new RenException("MCP API validation failed: " + e.getMessage());
        }
    }
}
