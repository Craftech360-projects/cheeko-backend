package cheeko.modules.sys.dto;

import lombok.Data;
import cheeko.modules.sys.enums.ServerActionEnum;

import java.util.Map;

/**
 * Server action DTO
 */
@Data
public class ServerActionPayloadDTO
{
    /**
    * Type (all from control panel to server are "server")
    */
    private String type;
    /**
    * Action
    */
    private ServerActionEnum action;
    /**
    * Content
    */
    private Map<String, Object> content;

    public static ServerActionPayloadDTO build(ServerActionEnum action, Map<String, Object> content) {
        ServerActionPayloadDTO serverActionPayloadDTO = new ServerActionPayloadDTO();
        serverActionPayloadDTO.setAction(action);
        serverActionPayloadDTO.setContent(content);
        serverActionPayloadDTO.setType("server");
        return serverActionPayloadDTO;
    }
    // Private constructor
    private ServerActionPayloadDTO() {}
}
