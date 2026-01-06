package cheeko.modules.agent.Enums;

import cheeko.common.utils.JsonUtils;
import cheeko.common.utils.JsonRpcTwo;

import java.util.Map;


/**
 * Cheeko MCP JSON-RPC Request json
 */
public class CheekoMcpJsonRpcJson {
    // Cheeko Initialize MCP Request json
    private static final String INITIALIZE_JSON;
    // Cheeko MCP Initialize Success, Return Notification Request json
    private static final String NOTIFICATIONS_INITIALIZED_JSON;
    // Cheeko MCP Get MCP Tools Collection Request json
    private static final String TOOLS_LIST_REQUEST;
    // Lazy loading
    static {
        INITIALIZE_JSON = JsonUtils.toJsonString(new JsonRpcTwo("initialize",
                Map.of(
                        "protocolVersion", "2024-11-05",
                        "capabilities", Map.of(
                                "roots", Map.of("listChanged", false),
                                "sampling", Map.of()),
                        "clientInfo", Map.of(
                                "name", "xz-mcp-broker",
                                "version", "0.0.1")),
                1));
        NOTIFICATIONS_INITIALIZED_JSON = "{\"jsonrpc\":\"2.0\",\"method\":\"notifications/initialized\"}";
        TOOLS_LIST_REQUEST = JsonUtils.toJsonString(new JsonRpcTwo("tools/list", null, 2));
    }
    public static String getInitializeJson(){
        return INITIALIZE_JSON;
    }
    public static String getNotificationsInitializedJson(){
        return NOTIFICATIONS_INITIALIZED_JSON;
    }
    public static String getToolsListJson(){
        return TOOLS_LIST_REQUEST;
    }

}
