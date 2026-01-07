package cheeko.modules.rfid.dto;

import java.io.Serializable;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;

/**
 * RFID Content Lookup DTO
 * Response DTO for device tap endpoint with content pack support
 */
@Data
@Schema(description = "RFID Content Lookup Response")
public class RfidContentLookupDTO implements Serializable {

    @Schema(description = "RFID card UID")
    private String rfidUid;

    @Schema(description = "Content type: read_only (TTS only) or prompt (send to LLM)")
    private String contentType;

    @Schema(description = "Title of the content item (e.g., Twinkle Twinkle Little Star)")
    private String title;

    @Schema(description = "Content text to be spoken (for read_only mode)")
    private String contentText;

    @Schema(description = "Prompt text to send to LLM (for prompt mode, backward compatible)")
    private String promptText;

    @Schema(description = "Sequence number within the pack")
    private Integer sequence;

    @Schema(description = "Pack code")
    private String packCode;

    @Schema(description = "Language code")
    private String language;
}
