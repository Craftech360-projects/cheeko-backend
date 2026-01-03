package cheeko.modules.content.entity;

import java.io.Serializable;
import java.util.Date;

import com.baomidou.mybatisplus.annotation.FieldFill;
import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;

/**
 * Music Playlist Entity
 * Represents music playlists for devices
 *
 * @TableName music_playlist
 */
@TableName(value = "music_playlist")
@Data
@Schema(description = "Music Playlist")
public class MusicPlaylistEntity implements Serializable {

    @TableId(type = IdType.AUTO)
    @Schema(description = "Primary key")
    private Long id;

    @Schema(description = "Device ID (references ai_device.id)")
    private String deviceId;

    @Schema(description = "Content ID (references content_items.id)")
    private String contentId;

    @Schema(description = "Position in playlist (0-based ordering)")
    private Integer position;

    @Schema(description = "Creation timestamp")
    @TableField(fill = FieldFill.INSERT)
    private Date createdAt;

    @Schema(description = "Update timestamp")
    @TableField(fill = FieldFill.UPDATE)
    private Date updatedAt;

    @TableField(exist = false)
    private static final long serialVersionUID = 1L;
}
