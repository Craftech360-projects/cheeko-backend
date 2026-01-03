package cheeko.modules.device.controller;

import java.io.File;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Map;
import java.util.UUID;

import org.apache.commons.lang3.StringUtils;
import org.apache.shiro.authz.annotation.RequiresPermissions;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.Parameters;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import cheeko.common.constant.Constant;
import cheeko.common.page.PageData;
import cheeko.common.redis.RedisKeys;
import cheeko.common.redis.RedisUtils;
import cheeko.common.utils.Result;
import cheeko.common.validator.ValidatorUtils;
import cheeko.modules.device.entity.OtaEntity;
import cheeko.modules.device.service.OtaService;

@Tag(name = "Device Management", description = "OTA 相关Interface")
@Slf4j
@RestController
@RequiredArgsConstructor
@RequestMapping("/otaMag")
public class OTAMagController {
    private static final Logger logger = LoggerFactory.getLogger(OTAController.class);
    private final OtaService otaService;
    private final RedisUtils redisUtils;

    @GetMapping
    @Operation(summary = "PaginationQuery OTA FirmwareInformation")
    @Parameters({
            @Parameter(name = Constant.PAGE, description = "CurrentPage Number，from1Start", required = true),
            @Parameter(name = Constant.LIMIT, description = "Per PagedisplayRecordcount", required = true)
    })
    @RequiresPermissions("sys:role:superAdmin")
    public Result<PageData<OtaEntity>> page(@Parameter(hidden = true) @RequestParam Map<String, Object> params) {
        ValidatorUtils.validateEntity(params);
        PageData<OtaEntity> page = otaService.page(params);
        return new Result<PageData<OtaEntity>>().ok(page);
    }

    @GetMapping("{id}")
    @Operation(summary = "Information OTA FirmwareInformation")
    @RequiresPermissions("sys:role:superAdmin")
    public Result<OtaEntity> get(@PathVariable("id") String id) {
        OtaEntity data = otaService.selectById(id);
        return new Result<OtaEntity>().ok(data);
    }

    @PostMapping
    @Operation(summary = "Save OTA FirmwareInformation")
    @RequiresPermissions("sys:role:superAdmin")
    public Result<Void> save(@RequestBody OtaEntity entity) {
        if (entity == null) {
            return new Result<Void>().error("FirmwareInformationCannot beEmpty");
        }
        if (StringUtils.isBlank(entity.getFirmwareName())) {
            return new Result<Void>().error("FirmwareNameCannot beEmpty");
        }
        if (StringUtils.isBlank(entity.getType())) {
            return new Result<Void>().error("FirmwareTypeCannot beEmpty");
        }
        if (StringUtils.isBlank(entity.getVersion())) {
            return new Result<Void>().error("Version号Cannot beEmpty");
        }
        try {
            otaService.save(entity);
            return new Result<Void>();
        } catch (RuntimeException e) {
            return new Result<Void>().error(e.getMessage());
        }
    }

    @DeleteMapping("/{id}")
    @Operation(summary = "OTA Delete")
    @RequiresPermissions("sys:role:superAdmin")
    public Result<Void> delete(@PathVariable("id") String[] ids) {
        if (ids == null || ids.length == 0) {
            return new Result<Void>().error("Deletes FirmwareIDCannot beEmpty");
        }
        otaService.delete(ids);
        return new Result<Void>();
    }

    @PutMapping("/{id}")
    @Operation(summary = "Update OTA FirmwareInformation")
    @RequiresPermissions("sys:role:superAdmin")
    public Result<?> update(@PathVariable("id") String id, @RequestBody OtaEntity entity) {
        if (entity == null) {
            return new Result<>().error("FirmwareInformationCannot beEmpty");
        }
        entity.setId(id);
        try {
            otaService.update(entity);
            return new Result<>();
        } catch (RuntimeException e) {
            return new Result<>().error(e.getMessage());
        }
    }

    @PutMapping("/forceUpdate/{id}")
    @Operation(summary = "SetFirmware强制Update")
    @RequiresPermissions("sys:role:superAdmin")
    public Result<Void> setForceUpdate(
            @PathVariable("id") String id,
            @RequestBody Map<String, Object> params) {
        if (params == null || !params.containsKey("forceUpdate") || !params.containsKey("type")) {
            return new Result<Void>().error("Parameter不完整");
        }

        Integer forceUpdate = (Integer) params.get("forceUpdate");
        String type = (String) params.get("type");

        try {
            otaService.setForceUpdate(id, type, forceUpdate);
            return new Result<Void>();
        } catch (RuntimeException e) {
            return new Result<Void>().error(e.getMessage());
        }
    }

    @GetMapping("/getDownloadUrl/{id}")
    @Operation(summary = "Get OTA FirmwareDownloadLink")
    @RequiresPermissions("sys:role:superAdmin")
    public Result<String> getDownloadUrl(@PathVariable("id") String id) {
        String uuid = UUID.randomUUID().toString();
        redisUtils.set(RedisKeys.getOtaIdKey(uuid), id);
        return new Result<String>().ok(uuid);
    }

    @GetMapping("/download/{uuid}")
    @Operation(summary = "DownloadFirmwareFile")
    public ResponseEntity<byte[]> downloadFirmware(@PathVariable("uuid") String uuid) {
        String id = (String) redisUtils.get(RedisKeys.getOtaIdKey(uuid));
        if (StringUtils.isBlank(id)) {
            return ResponseEntity.notFound().build();
        }

        // CheckDownload次count
        String downloadCountKey = RedisKeys.getOtaDownloadCountKey(uuid);
        Integer downloadCount = (Integer) redisUtils.get(downloadCountKey);
        if (downloadCount == null) {
            downloadCount = 0;
        }

        // IfDownload次count超过3次，Return404
        if (downloadCount >= 3) {
            redisUtils.delete(downloadCountKey);
            redisUtils.delete(RedisKeys.getOtaIdKey(uuid));
            return ResponseEntity.notFound().build();
        }

        redisUtils.set(downloadCountKey, downloadCount + 1);

        try {
            // GetFirmwareInformation
            OtaEntity otaEntity = otaService.selectById(id);
            if (otaEntity == null || StringUtils.isBlank(otaEntity.getFirmwarePath())) {
                return ResponseEntity.notFound().build();
            }

            // GetFilePath
            String firmwarePath = otaEntity.getFirmwarePath();
            Path path;

            if (Paths.get(firmwarePath).isAbsolute()) {
                path = Paths.get(firmwarePath);
            } else {
                path = Paths.get(System.getProperty("user.dir"), firmwarePath);
            }

            if (!Files.exists(path) || !Files.isRegularFile(path)) {
                // 尝试fromfirmware目录Query
                String fileName = new File(firmwarePath).getName();
                Path altPath = Paths.get(System.getProperty("user.dir"), "firmware", fileName);

                if (Files.exists(altPath) && Files.isRegularFile(altPath)) {
                    path = altPath;
                } else {
                    logger.error("FirmwareFile未找到: {}", firmwarePath);
                    return ResponseEntity.notFound().build();
                }
            }

            // ReadFileContent
            byte[] fileContent = Files.readAllBytes(path);

            // SetResponseHeader
            String originalFilename = otaEntity.getType() + "_" + otaEntity.getVersion();
            if (firmwarePath.contains(".")) {
                String extension = firmwarePath.substring(firmwarePath.lastIndexOf("."));
                originalFilename += extension;
            }

            String safeFilename = originalFilename.replaceAll("[^a-zA-Z0-9._-]", "_");

            return ResponseEntity.ok()
                    .contentType(MediaType.APPLICATION_OCTET_STREAM)
                    .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"" + safeFilename + "\"")
                    .body(fileContent);
        } catch (IOException e) {
            logger.error("ReadFirmwareFileFailure", e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build();
        } catch (Exception e) {
            logger.error("DownloadFirmwareTime发生Error", e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build();
        }
    }

    @PostMapping("/upload")
    @Operation(summary = "UploadFirmwareFile")
    @RequiresPermissions("sys:role:superAdmin")
    public Result<String> uploadFirmware(@RequestParam("file") MultipartFile file) {
        if (file.isEmpty()) {
            return new Result<String>().error("UploadFileCannot beEmpty");
        }

        // CheckFileExtensionName
        String originalFilename = file.getOriginalFilename();
        if (originalFilename == null) {
            return new Result<String>().error("FileNameCannot beEmpty");
        }

        String extension = originalFilename.substring(originalFilename.lastIndexOf(".")).toLowerCase();
        if (!extension.equals(".bin") && !extension.equals(".apk")) {
            return new Result<String>().error("OnlyAllowUpload.bin和.apk格式s File");
        }

        try {
            // CalculateFiles MD5值
            String md5 = calculateMD5(file);

            // Set存储Path
            String uploadDir = "uploadfile";
            Path uploadPath = Paths.get(uploadDir);

            // If目录不Exist，Create目录
            if (!Files.exists(uploadPath)) {
                Files.createDirectories(uploadPath);
            }

            // UseMD5AsAsFileName，固定Use.binExtensionName
            String uniqueFileName = md5 + extension;
            Path filePath = uploadPath.resolve(uniqueFileName);

            // CheckFileWhetherHaveExist
            if (Files.exists(filePath)) {
                return new Result<String>().ok(filePath.toString());
            }

            // SaveFile
            Files.copy(file.getInputStream(), filePath);

            // ReturnFilePath
            return new Result<String>().ok(filePath.toString());
        } catch (IOException | NoSuchAlgorithmException e) {
            return new Result<String>().error("FileUploadFailure：" + e.getMessage());
        }
    }

    private String calculateMD5(MultipartFile file) throws IOException, NoSuchAlgorithmException {
        MessageDigest md = MessageDigest.getInstance("MD5");
        byte[] digest = md.digest(file.getBytes());
        StringBuilder sb = new StringBuilder();
        for (byte b : digest) {
            sb.append(String.format("%02x", b));
        }
        return sb.toString();
    }
}
