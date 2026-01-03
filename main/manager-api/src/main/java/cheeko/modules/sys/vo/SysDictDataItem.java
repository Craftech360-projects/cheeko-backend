package cheeko.modules.sys.vo;

import java.io.Serializable;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;

/**
 * Dictionary Data Item VO
 */
@Data
@Schema(description = "Dictionary Data Item")
public class SysDictDataItem implements Serializable {

    @Schema(description = "Dictionary Label")
    private String name;

    @Schema(description = "Dictionary Value")
    private String key;
}
