package cheeko.modules.content.controller;

import java.util.List;

import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.AllArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import cheeko.common.utils.Result;
import cheeko.modules.content.dto.PlaylistAddRequest;
import cheeko.modules.content.dto.PlaylistItemDTO;
import cheeko.modules.content.dto.PlaylistOperationResponse;
import cheeko.modules.content.dto.PlaylistReorderRequest;
import cheeko.modules.content.dto.PlaylistReplaceRequest;
import cheeko.modules.content.service.PlaylistService;

/**
 * Playlist CRUD REST API Controller
 * Full create, read, update, delete operations for device playlists
 */
@RestController
@RequestMapping("/device")
@AllArgsConstructor
@Slf4j
@Tag(name = "Device Playlists", description = "Complete CRUD operations for device playlists")
public class PlaylistController {

    private final PlaylistService playlistService;

    // ========================================
    // MUSIC PLAYLIST APIs
    // ========================================

    @GetMapping("/{macAddress}/playlist/music")
    @Operation(
        summary = "Get music playlist",
        description = "Retrieves music playlist for a device. Returns filename and language without full URLs."
    )
    public Result<List<PlaylistItemDTO>> getMusicPlaylist(
            @Parameter(description = "Device MAC address", example = "6825ddbbf3a0")
            @PathVariable String macAddress) {

        log.info("GET music playlist for MAC: {}", macAddress);
        List<PlaylistItemDTO> playlist = playlistService.getMusicPlaylistByMac(macAddress);
        return new Result<List<PlaylistItemDTO>>().ok(playlist);
    }

    @PostMapping("/{macAddress}/playlist/music")
    @Operation(
        summary = "Add songs to music playlist",
        description = "Appends songs to the end of existing music playlist"
    )
    public Result<PlaylistOperationResponse> addToMusicPlaylist(
            @Parameter(description = "Device MAC address", example = "6825ddbbf3a0")
            @PathVariable String macAddress,
            @RequestBody PlaylistAddRequest request) {

        log.info("POST add {} songs to music playlist for MAC: {}", request.getContentIds().size(), macAddress);
        Integer added = playlistService.addToMusicPlaylist(macAddress, request.getContentIds());

        PlaylistOperationResponse response = new PlaylistOperationResponse(
            "Added " + added + " songs to playlist",
            added
        );
        return new Result<PlaylistOperationResponse>().ok(response);
    }

    @PutMapping("/{macAddress}/playlist/music")
    @Operation(
        summary = "Replace music playlist",
        description = "Replaces entire music playlist with new songs"
    )
    public Result<PlaylistOperationResponse> replaceMusicPlaylist(
            @Parameter(description = "Device MAC address", example = "6825ddbbf3a0")
            @PathVariable String macAddress,
            @RequestBody PlaylistReplaceRequest request) {

        log.info("PUT replace music playlist for MAC: {} with {} songs", macAddress, request.getContentIds().size());
        Integer total = playlistService.replaceMusicPlaylist(macAddress, request.getContentIds());

        PlaylistOperationResponse response = new PlaylistOperationResponse(
            "Playlist replaced successfully",
            total
        );
        return new Result<PlaylistOperationResponse>().ok(response);
    }

    @PatchMapping("/{macAddress}/playlist/music/reorder")
    @Operation(
        summary = "Reorder music playlist",
        description = "Updates positions of music playlist items (for drag-and-drop reordering)"
    )
    public Result<PlaylistOperationResponse> reorderMusicPlaylist(
            @Parameter(description = "Device MAC address", example = "6825ddbbf3a0")
            @PathVariable String macAddress,
            @RequestBody PlaylistReorderRequest request) {

        log.info("PATCH reorder music playlist for MAC: {}", macAddress);
        playlistService.reorderMusicPlaylist(macAddress, request.getItems());

        PlaylistOperationResponse response = new PlaylistOperationResponse(
            "Playlist reordered successfully",
            request.getItems().size()
        );
        return new Result<PlaylistOperationResponse>().ok(response);
    }

    @DeleteMapping("/{macAddress}/playlist/music/{contentId}")
    @Operation(
        summary = "Remove song from music playlist",
        description = "Removes a specific song and re-adjusts positions"
    )
    public Result<PlaylistOperationResponse> removeFromMusicPlaylist(
            @Parameter(description = "Device MAC address", example = "6825ddbbf3a0")
            @PathVariable String macAddress,
            @Parameter(description = "Content ID to remove")
            @PathVariable String contentId) {

        log.info("DELETE remove song {} from music playlist for MAC: {}", contentId, macAddress);
        Integer remaining = playlistService.removeFromMusicPlaylist(macAddress, contentId);

        PlaylistOperationResponse response = new PlaylistOperationResponse(
            "Song removed from playlist",
            remaining
        );
        return new Result<PlaylistOperationResponse>().ok(response);
    }

    @DeleteMapping("/{macAddress}/playlist/music")
    @Operation(
        summary = "Clear music playlist",
        description = "Removes all songs from music playlist"
    )
    public Result<PlaylistOperationResponse> clearMusicPlaylist(
            @Parameter(description = "Device MAC address", example = "6825ddbbf3a0")
            @PathVariable String macAddress) {

        log.info("DELETE clear music playlist for MAC: {}", macAddress);
        playlistService.clearMusicPlaylist(macAddress);

        PlaylistOperationResponse response = new PlaylistOperationResponse(
            "Playlist cleared successfully",
            0
        );
        return new Result<PlaylistOperationResponse>().ok(response);
    }

    // ========================================
    // STORY PLAYLIST APIs
    // ========================================

    @GetMapping("/{macAddress}/playlist/story")
    @Operation(
        summary = "Get story playlist",
        description = "Retrieves story playlist for a device. Returns filename and category without full URLs."
    )
    public Result<List<PlaylistItemDTO>> getStoryPlaylist(
            @Parameter(description = "Device MAC address", example = "6825ddbbf3a0")
            @PathVariable String macAddress) {

        log.info("GET story playlist for MAC: {}", macAddress);
        List<PlaylistItemDTO> playlist = playlistService.getStoryPlaylistByMac(macAddress);
        return new Result<List<PlaylistItemDTO>>().ok(playlist);
    }

    @PostMapping("/{macAddress}/playlist/story")
    @Operation(
        summary = "Add stories to story playlist",
        description = "Appends stories to the end of existing story playlist"
    )
    public Result<PlaylistOperationResponse> addToStoryPlaylist(
            @Parameter(description = "Device MAC address", example = "6825ddbbf3a0")
            @PathVariable String macAddress,
            @RequestBody PlaylistAddRequest request) {

        log.info("POST add {} stories to story playlist for MAC: {}", request.getContentIds().size(), macAddress);
        Integer added = playlistService.addToStoryPlaylist(macAddress, request.getContentIds());

        PlaylistOperationResponse response = new PlaylistOperationResponse(
            "Added " + added + " stories to playlist",
            added
        );
        return new Result<PlaylistOperationResponse>().ok(response);
    }

    @PutMapping("/{macAddress}/playlist/story")
    @Operation(
        summary = "Replace story playlist",
        description = "Replaces entire story playlist with new stories"
    )
    public Result<PlaylistOperationResponse> replaceStoryPlaylist(
            @Parameter(description = "Device MAC address", example = "6825ddbbf3a0")
            @PathVariable String macAddress,
            @RequestBody PlaylistReplaceRequest request) {

        log.info("PUT replace story playlist for MAC: {} with {} stories", macAddress, request.getContentIds().size());
        Integer total = playlistService.replaceStoryPlaylist(macAddress, request.getContentIds());

        PlaylistOperationResponse response = new PlaylistOperationResponse(
            "Playlist replaced successfully",
            total
        );
        return new Result<PlaylistOperationResponse>().ok(response);
    }

    @PatchMapping("/{macAddress}/playlist/story/reorder")
    @Operation(
        summary = "Reorder story playlist",
        description = "Updates positions of story playlist items (for drag-and-drop reordering)"
    )
    public Result<PlaylistOperationResponse> reorderStoryPlaylist(
            @Parameter(description = "Device MAC address", example = "6825ddbbf3a0")
            @PathVariable String macAddress,
            @RequestBody PlaylistReorderRequest request) {

        log.info("PATCH reorder story playlist for MAC: {}", macAddress);
        playlistService.reorderStoryPlaylist(macAddress, request.getItems());

        PlaylistOperationResponse response = new PlaylistOperationResponse(
            "Playlist reordered successfully",
            request.getItems().size()
        );
        return new Result<PlaylistOperationResponse>().ok(response);
    }

    @DeleteMapping("/{macAddress}/playlist/story/{contentId}")
    @Operation(
        summary = "Remove story from story playlist",
        description = "Removes a specific story and re-adjusts positions"
    )
    public Result<PlaylistOperationResponse> removeFromStoryPlaylist(
            @Parameter(description = "Device MAC address", example = "6825ddbbf3a0")
            @PathVariable String macAddress,
            @Parameter(description = "Content ID to remove")
            @PathVariable String contentId) {

        log.info("DELETE remove story {} from story playlist for MAC: {}", contentId, macAddress);
        Integer remaining = playlistService.removeFromStoryPlaylist(macAddress, contentId);

        PlaylistOperationResponse response = new PlaylistOperationResponse(
            "Story removed from playlist",
            remaining
        );
        return new Result<PlaylistOperationResponse>().ok(response);
    }

    @DeleteMapping("/{macAddress}/playlist/story")
    @Operation(
        summary = "Clear story playlist",
        description = "Removes all stories from story playlist"
    )
    public Result<PlaylistOperationResponse> clearStoryPlaylist(
            @Parameter(description = "Device MAC address", example = "6825ddbbf3a0")
            @PathVariable String macAddress) {

        log.info("DELETE clear story playlist for MAC: {}", macAddress);
        playlistService.clearStoryPlaylist(macAddress);

        PlaylistOperationResponse response = new PlaylistOperationResponse(
            "Playlist cleared successfully",
            0
        );
        return new Result<PlaylistOperationResponse>().ok(response);
    }
}
