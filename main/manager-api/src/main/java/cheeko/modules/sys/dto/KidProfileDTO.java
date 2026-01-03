package cheeko.modules.sys.dto;

import java.io.Serializable;
import java.util.Date;
import java.time.LocalDate;
import java.time.Period;
import java.time.ZoneId;

import com.fasterxml.jackson.annotation.JsonFormat;
import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;

/**
 * Kid Profile DTO
 */
@Data
@Schema(description = "Kid Profile")
public class KidProfileDTO implements Serializable {
    private static final long serialVersionUID = 1L;

    @Schema(description = "ID")
    private Long id;

    @Schema(description = "User ID (parent)")
    private Long userId;

    @Schema(description = "Child name")
    private String name;

    @Schema(description = "Date of birth", example = "2015-10-12")
    @JsonFormat(pattern = "yyyy-MM-dd", timezone = "UTC")
    private Date dateOfBirth;

    @Schema(description = "Gender")
    private String gender;

    @Schema(description = "Interests (JSON array)")
    private String interests;

    @Schema(description = "Avatar URL")
    private String avatarUrl;

    @Schema(description = "Primary language for AI conversations")
    private String primaryLanguage;

    @Schema(description = "Parent-provided context about child personality, traits, likes, dislikes, challenges")
    private String additionalNotes;

    @Schema(description = "Creator")
    private Long creator;

    @Schema(description = "Create date")
    private Date createDate;

    @Schema(description = "Updater")
    private Long updater;

    @Schema(description = "Update date")
    private Date updateDate;

    /**
     * Calculate age from date of birth
     */
    public Integer getAge() {
        if (dateOfBirth == null) {
            return null;
        }
        LocalDate birthDate = dateOfBirth.toInstant().atZone(ZoneId.systemDefault()).toLocalDate();
        LocalDate now = LocalDate.now();
        return Period.between(birthDate, now).getYears();
    }

    /**
     * Get age group based on age
     */
    public String getAgeGroup() {
        Integer age = getAge();
        if (age == null) {
            return "Unknown";
        }
        if (age < 3) return "Toddler";
        if (age >= 3 && age <= 5) return "Preschool";
        if (age >= 6 && age <= 8) return "Early Elementary";
        if (age >= 9 && age <= 11) return "Late Elementary";
        if (age >= 12 && age <= 14) return "Early Teen";
        return "Teen";
    }
}
