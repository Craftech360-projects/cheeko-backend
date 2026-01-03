package cheeko.modules.agent.service;


import java.util.List;

/**
 * AgentMcpAccess PointHandleservice
 *
 * @author zjy
 */
public interface AgentMcpAccessPointService {
    /**
     * GetAgents mcpAccess PointAddress
     * @param id Agentid
     * @return mcpAccess PointAddress
     */
   String getAgentMcpAccessAddress(String id);

    /**
     * GetAgents mcpAccess PointHaveHaves UtilsList
     * @param id Agentid
     * @return UtilsList
     */
   List<String> getAgentMcpToolsList(String id);
}
