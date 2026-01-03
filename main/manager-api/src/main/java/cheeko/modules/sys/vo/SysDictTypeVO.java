package cheeko.modules.sys.vo;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;

import java.io.Serializable;
import java.util.Date;

/**
 * Dictionary Type VO
 */
@Data
@Schema(description = "Dictionary Type VO")
public class SysDictTypeVO implements Serializable {
    @Schema(description = "Primary Key")
    private Long id;

    @Schema(description = "Dictionary Type")
    private String dictType;

    @Schema(description = "Dictionary Name")
    private String dictName;

    @Schema(description = "Remark")
    private String remark;

    @Schema(description = "Sort Order")
    private Integer sort;

    @Schema(description = "Creator")
    private Long creator;

    @Schema(description = "CreatorName")
    private String creatorName;

    @Schema(description = "Create Time")
    private Date createDate;

    @Schema(description = "Updater")
    private Long updater;

    @Schema(description = "UpdaterName")
    private String updaterName;

    @Schema(description = "Update Time")
    private Date updateDate;
}
