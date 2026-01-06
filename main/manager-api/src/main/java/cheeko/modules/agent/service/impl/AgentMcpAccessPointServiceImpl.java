package cheeko.modules.agent.service.impl;

import java.net.URI;
import java.net.URISyntaxException;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.concurrent.TimeUnit;
import java.util.stream.Collectors;

import org.apache.commons.lang3.StringUtils;
import org.springframework.stereotype.Service;

import lombok.AllArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import cheeko.common.constant.Constant;
import cheeko.common.utils.AESUtils;
import cheeko.common.utils.HashEncryptionUtil;
import cheeko.common.utils.JsonUtils;
import cheeko.modules.agent.Enums.CheekoMcpJsonRpcJson;
import cheeko.modules.agent.service.AgentMcpAccessPointService;
import cheeko.modules.sys.service.SysParamsService;
import cheeko.modules.sys.utils.WebSocketClientManager;

@AllArgsConstructor
@Service
@Slf4j
public class AgentMcpAccessPointServiceImpl implements AgentMcpAccessPointService {
    private SysParamsService sysParamsService;

    @Override
    public String getAgentMcpAccessAddress(String id) {
        // Get MCP address
        String url = sysParamsService.getValue(Constant.SERVER_MCP_ENDPOINT, true);
        if (StringUtils.isBlank(url) || "null".equals(url)) {
            return null;
        }
        URI uri = getURI(url);
        // Get agent MCP URL prefix
        String agentMcpUrl = getAgentMcpUrl(uri);
        // Get secret key
        String key = getSecretKey(uri);
        // Get encrypted token
        String encryptToken = encryptToken(id, key);
        // URL encode the token
        String encodedToken = URLEncoder.encode(encryptToken, StandardCharsets.UTF_8);
        // Return agent MCP path format
        agentMcpUrl = "%s/mcp/?token=%s".formatted(agentMcpUrl, encodedToken);
        return agentMcpUrl;
    }

    @Override
    public List<String> getAgentMcpToolsList(String id) {
        String wsUrl = getAgentMcpAccessAddress(id);
        if (StringUtils.isBlank(wsUrl)) {
            return List.of();
        }

        // Replace /mcp with /call
        wsUrl = wsUrl.replace("/mcp/", "/call/");

        try {
            // Create WebSocket connection, increase timeout to 15 seconds
            try (WebSocketClientManager client = WebSocketClientManager.build(
                    new WebSocketClientManager.Builder()
                            .uri(wsUrl)
                            .bufferSize(1024 * 1024)
                            .connectTimeout(8, TimeUnit.SECONDS)
                            .maxSessionDuration(10, TimeUnit.SECONDS))) {

                // Step 1: Send initialize message and wait for response
                log.info("Sending MCP initialize message, AgentID: {}", id);
                client.sendText(CheekoMcpJsonRpcJson.getInitializeJson());

                // Wait for initialize response (id=1) - removed fixed delay, changed to response-driven
                List<String> initResponses = client.listenerWithoutClose(response -> {
                    try {
                        Map<String, Object> jsonMap = JsonUtils.parseObject(response, Map.class);
                        if (jsonMap != null && Integer.valueOf(1).equals(jsonMap.get("id"))) {
                            // Check whether result field exists, indicating initialize success
                            return jsonMap.containsKey("result") && !jsonMap.containsKey("error");
                        }
                        return false;
                    } catch (Exception e) {
                        log.warn("Parse initialize response failure: {}", response, e);
                        return false;
                    }
                });

                // Validate initialize response
                boolean initSucceeded = false;
                for (String response : initResponses) {
                    try {
                        Map<String, Object> jsonMap = JsonUtils.parseObject(response, Map.class);
                        if (jsonMap != null && Integer.valueOf(1).equals(jsonMap.get("id"))) {
                            if (jsonMap.containsKey("result")) {
                                log.info("MCP initialize success, AgentID: {}", id);
                                initSucceeded = true;
                                break;
                            } else if (jsonMap.containsKey("error")) {
                                log.error("MCP initialize failure, AgentID: {}, Error: {}", id, jsonMap.get("error"));
                                return List.of();
                            }
                        }
                    } catch (Exception e) {
                        log.warn("Handle initialize response failure: {}", response, e);
                    }
                }

                if (!initSucceeded) {
                    log.error("Did not receive valid MCP initialize response, AgentID: {}", id);
                    return List.of();
                }

                // Step 2: Send initialize complete notification - only send after receiving initialize response
                log.info("Sending MCP initialize complete notification, AgentID: {}", id);
                client.sendText(CheekoMcpJsonRpcJson.getNotificationsInitializedJson());
                // Step 3: Send tools list request - send immediately, no additional delay needed
                log.info("Sending MCP tools list request, AgentID: {}", id);
                client.sendText(CheekoMcpJsonRpcJson.getToolsListJson());

                // Wait for tools list response (id=2)
                List<String> toolsResponses = client.listener(response -> {
                    try {
                        Map<String, Object> jsonMap = JsonUtils.parseObject(response, Map.class);
                        return jsonMap != null && Integer.valueOf(2).equals(jsonMap.get("id"));
                    } catch (Exception e) {
                        log.warn("Parse tools list response failure: {}", response, e);
                        return false;
                    }
                });

                // Handle tools list response
                for (String response : toolsResponses) {
                    try {
                        Map<String, Object> jsonMap = JsonUtils.parseObject(response, Map.class);
                        if (jsonMap != null && Integer.valueOf(2).equals(jsonMap.get("id"))) {
                            // Check whether result field exists
                            Object resultObj = jsonMap.get("result");
                            if (resultObj instanceof Map) {
                                Map<String, Object> resultMap = (Map<String, Object>) resultObj;
                                Object toolsObj = resultMap.get("tools");
                                if (toolsObj instanceof List) {
                                    List<Map<String, Object>> toolsList = (List<Map<String, Object>>) toolsObj;
                                    // Extract tool names list
                                    List<String> result = toolsList.stream()
                                            .map(tool -> (String) tool.get("name"))
                                            .filter(name -> name != null)
                                            .collect(Collectors.toList());
                                    log.info("Successfully got MCP tools list, AgentID: {}, Tools count: {}", id, result.size());
                                    return result;
                                }
                            } else if (jsonMap.containsKey("error")) {
                                log.error("Get tools list failure, AgentID: {}, Error: {}", id, jsonMap.get("error"));
                                return List.of();
                            }
                        }
                    } catch (Exception e) {
                        log.warn("Handle tools list response failure: {}", response, e);
                    }
                }

                log.warn("Did not find valid tools list response, AgentID: {}", id);
                return List.of();

            }
        } catch (Exception e) {
            log.error("Get agent MCP tools list failure, AgentID: {}, Error reason: {}", id, e.getMessage());
            return List.of();
        }
    }

    /**
     * Get URI object
     *
     * @param url Path
     * @return URI object
     */
    private static URI getURI(String url) {
        try {
            return new URI(url);
        } catch (URISyntaxException e) {
            log.error("Invalid path format, Path: {}, Error information: {}", url, e.getMessage());
            throw new RuntimeException("MCP address error, please go to parameter management to update MCP access point address");
        }
    }

    /**
     * Get secret key
     *
     * @param uri MCP address
     * @return Secret key
     */
    private static String getSecretKey(URI uri) {
        // Get parameters
        String query = uri.getQuery();
        // Get AES encryption secret key
        String str = "key=";
        return query.substring(query.indexOf(str) + str.length());
    }

    /**
     * Get agent MCP access point URL
     *
     * @param uri MCP address
     * @return Agent MCP access point URL
     */
    private String getAgentMcpUrl(URI uri) {
        // Get protocol
        String wsScheme = (uri.getScheme().equals("https")) ? "wss" : "ws";
        // Get host, port, path
        String path = uri.getSchemeSpecificPart();
        // Get path before the last /
        path = path.substring(0, path.lastIndexOf("/"));
        return wsScheme + ":" + path;
    }

    /**
     * Get encrypted token for agent ID
     *
     * @param agentId Agent ID
     * @param key     Encryption secret key
     * @return Encrypted token
     */
    private static String encryptToken(String agentId, String key) {
        // Use MD5 to encrypt agent ID
        String md5 = HashEncryptionUtil.Md5hexDigest(agentId);
        // Text to be encrypted with AES
        String json = "{\"agentId\": \"%s\"}".formatted(md5);
        // Return encrypted token value
        return AESUtils.encrypt(key, json);
    }
}