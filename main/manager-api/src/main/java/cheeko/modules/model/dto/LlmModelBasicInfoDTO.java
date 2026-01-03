package cheeko.modules.model.dto;

import lombok.Data;
import lombok.EqualsAndHashCode;

/**
 * LLMs Models BasicDisplayData
 */
@EqualsAndHashCode(callSuper = true)
@Data
public class LlmModelBasicInfoDTO extends ModelBasicInfoDTO{
    private String type;
}