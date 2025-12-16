package xiaozhi.modules.device.entity;

import java.util.Date;

import com.baomidou.mybatisplus.annotation.FieldFill;
import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;

@Data
@TableName("toy_accessories")
@Schema(description = "Toy accessory binding (car, lamp, etc.)")
public class ToyAccessoryEntity {

    @TableId(type = IdType.AUTO)
    @Schema(description = "ID")
    private Long id;

    @Schema(description = "User ID (owner of the toy)")
    private Long userId;

    @Schema(description = "Parent toy MAC address")
    private String toyMac;

    @Schema(description = "Accessory MAC address")
    private String accessoryMac;

    @Schema(description = "Accessory type (car, lamp, sensor)")
    private String accessoryType;

    @Schema(description = "Created timestamp")
    @TableField(fill = FieldFill.INSERT)
    private Date createdAt;
}
