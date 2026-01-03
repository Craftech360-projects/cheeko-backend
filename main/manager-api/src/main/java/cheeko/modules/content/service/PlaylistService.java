package cheeko.modules.content.service;

import java.util.List;

import cheeko.modules.content.dto.PlaylistItemDTO;
import cheeko.modules.content.dto.PlaylistReorderRequest;

/**
 * Playlist Service Interface
 * Handles both music and story playlists
 */
public interface PlaylistService {

    // ========== READ ==========

    /**
     * Get music playlist for a device by MAC address
     * Returns playlist items with content details (filename, category) but without full URLs
     *
     * @param macAddress Device MAC address
     * @return List of music playlist items ordered by position
     */
    List<PlaylistItemDTO> getMusicPlaylistByMac(String macAddress);

    /**
     * Get story playlist for a device by MAC address
     * Returns playlist items with content details (filename, category) but without full URLs
     *
     * @param macAddress Device MAC address
     * @return List of story playlist items ordered by position
     */
    List<PlaylistItemDTO> getStoryPlaylistByMac(String macAddress);

    /**
     * Get music playlist for a device by device ID
     *
     * @param deviceId Device ID
     * @return List of music playlist items ordered by position
     */
    List<PlaylistItemDTO> getMusicPlaylistByDeviceId(String deviceId);

    /**
     * Get story playlist for a device by device ID
     *
     * @param deviceId Device ID
     * @return List of story playlist items ordered by position
     */
    List<PlaylistItemDTO> getStoryPlaylistByDeviceId(String deviceId);

    // ========== CREATE ==========

    /**
     * Add songs to music playlist (appends to end)
     *
     * @param macAddress Device MAC address
     * @param contentIds List of content IDs to add
     * @return Number of items added
     */
    Integer addToMusicPlaylist(String macAddress, List<String> contentIds);

    /**
     * Add stories to story playlist (appends to end)
     *
     * @param macAddress Device MAC address
     * @param contentIds List of content IDs to add
     * @return Number of items added
     */
    Integer addToStoryPlaylist(String macAddress, List<String> contentIds);

    // ========== UPDATE ==========

    /**
     * Replace entire music playlist
     *
     * @param macAddress Device MAC address
     * @param contentIds List of content IDs for new playlist
     * @return Number of items in new playlist
     */
    Integer replaceMusicPlaylist(String macAddress, List<String> contentIds);

    /**
     * Replace entire story playlist
     *
     * @param macAddress Device MAC address
     * @param contentIds List of content IDs for new playlist
     * @return Number of items in new playlist
     */
    Integer replaceStoryPlaylist(String macAddress, List<String> contentIds);

    /**
     * Reorder music playlist items
     *
     * @param macAddress Device MAC address
     * @param items List of items with new positions
     * @return True if successful
     */
    Boolean reorderMusicPlaylist(String macAddress, List<PlaylistReorderRequest.ReorderItem> items);

    /**
     * Reorder story playlist items
     *
     * @param macAddress Device MAC address
     * @param items List of items with new positions
     * @return True if successful
     */
    Boolean reorderStoryPlaylist(String macAddress, List<PlaylistReorderRequest.ReorderItem> items);

    // ========== DELETE ==========

    /**
     * Remove a song from music playlist
     *
     * @param macAddress Device MAC address
     * @param contentId Content ID to remove
     * @return Number of remaining items
     */
    Integer removeFromMusicPlaylist(String macAddress, String contentId);

    /**
     * Remove a story from story playlist
     *
     * @param macAddress Device MAC address
     * @param contentId Content ID to remove
     * @return Number of remaining items
     */
    Integer removeFromStoryPlaylist(String macAddress, String contentId);

    /**
     * Clear entire music playlist
     *
     * @param macAddress Device MAC address
     * @return True if successful
     */
    Boolean clearMusicPlaylist(String macAddress);

    /**
     * Clear entire story playlist
     *
     * @param macAddress Device MAC address
     * @return True if successful
     */
    Boolean clearStoryPlaylist(String macAddress);
}
