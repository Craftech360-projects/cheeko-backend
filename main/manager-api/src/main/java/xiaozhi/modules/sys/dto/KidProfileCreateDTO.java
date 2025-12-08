package xiaozhi.modules.sys.dto;

import java.io.Serializable;
import java.util.Date;

import com.fasterxml.jackson.annotation.JsonFormat;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import org.hibernate.validator.constraints.Length;
import lombok.Data;

/**
 * Kid Profile Create DTO
 */
@Data
@Schema(description = "Create Kid Profile Request")
public class KidProfileCreateDTO implements Serializable {
    private static final long serialVersionUID = 1L;

    @Schema(description = "Child name", required = true)
    @NotBlank(message = "Child name cannot be empty")
    private String name;

    @Schema(description = "Date of birth", required = true, example = "2015-10-12")
    @NotNull(message = "Date of birth cannot be empty")
    @JsonFormat(pattern = "yyyy-MM-dd", timezone = "UTC")
    private Date dateOfBirth;

    @Schema(description = "Gender (male/female/other)")
    private String gender;

    @Schema(description = "Interests (JSON array string)")
    private String interests;

    @Schema(description = "Avatar URL")
    private String avatarUrl;

    @Schema(description = "Primary language for AI conversations (English, Hindi, Kannada, Malayalam, etc.)", required = true, example = "English")
    @NotBlank(message = "Primary language is required")
    @Length(max = 50, message = "Primary language cannot exceed 50 characters")
    private String primaryLanguage = "English";

    @Schema(description = "Parent-provided context about child personality, traits, likes, dislikes, challenges", example = "Loves reading books about space, shy around new people")
    @Length(max = 5000, message = "Additional notes cannot exceed 5000 characters")
    private String additionalNotes;
}
