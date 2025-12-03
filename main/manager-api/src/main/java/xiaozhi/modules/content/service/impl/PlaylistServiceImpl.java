package xiaozhi.modules.content.service.impl;

import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;

import lombok.AllArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import xiaozhi.common.exception.RenException;
import xiaozhi.modules.content.dao.ContentItemsDao;
import xiaozhi.modules.content.dao.MusicPlaylistDao;
import xiaozhi.modules.content.dao.StoryPlaylistDao;
import xiaozhi.modules.content.dto.PlaylistItemDTO;
import xiaozhi.modules.content.dto.PlaylistReorderRequest;
import xiaozhi.modules.content.entity.ContentItemsEntity;
import xiaozhi.modules.content.entity.MusicPlaylistEntity;
import xiaozhi.modules.content.entity.StoryPlaylistEntity;
import xiaozhi.modules.content.service.PlaylistService;
import xiaozhi.modules.device.entity.DeviceEntity;
import xiaozhi.modules.device.service.DeviceService;

/**
 * Playlist Service Implementation
 * Handles both music and story playlists with full CRUD operations
 */
@Service
@AllArgsConstructor
@Slf4j
public class PlaylistServiceImpl implements PlaylistService {

    private final MusicPlaylistDao musicPlaylistDao;
    private final StoryPlaylistDao storyPlaylistDao;
    private final ContentItemsDao contentItemsDao;
    private final DeviceService deviceService;

    // ========== READ ==========

    @Override
    public List<PlaylistItemDTO> getMusicPlaylistByMac(String macAddress) {
        log.info("Getting music playlist for MAC: {}", macAddress);

        DeviceEntity device = deviceService.getDeviceByMacAddress(macAddress);
        if (device == null) {
            log.warn("Device not found for MAC: {}", macAddress);
            return new ArrayList<>();
        }

        return getMusicPlaylistByDeviceId(device.getId());
    }

    @Override
    public List<PlaylistItemDTO> getStoryPlaylistByMac(String macAddress) {
        log.info("Getting story playlist for MAC: {}", macAddress);

        DeviceEntity device = deviceService.getDeviceByMacAddress(macAddress);
        if (device == null) {
            log.warn("Device not found for MAC: {}", macAddress);
            return new ArrayList<>();
        }

        return getStoryPlaylistByDeviceId(device.getId());
    }

    @Override
    public List<PlaylistItemDTO> getMusicPlaylistByDeviceId(String deviceId) {
        log.info("Fetching music playlist for device ID: {}", deviceId);

        List<MusicPlaylistEntity> playlistEntries = musicPlaylistDao.getPlaylistByDeviceId(deviceId);

        if (playlistEntries == null || playlistEntries.isEmpty()) {
            log.info("No music playlist found for device: {}", deviceId);
            return new ArrayList<>();
        }

        return buildPlaylistItemDTOs(playlistEntries.stream()
                .map(MusicPlaylistEntity::getContentId)
                .collect(Collectors.toList()), playlistEntries);
    }

    @Override
    public List<PlaylistItemDTO> getStoryPlaylistByDeviceId(String deviceId) {
        log.info("Fetching story playlist for device ID: {}", deviceId);

        List<StoryPlaylistEntity> playlistEntries = storyPlaylistDao.getPlaylistByDeviceId(deviceId);

        if (playlistEntries == null || playlistEntries.isEmpty()) {
            log.info("No story playlist found for device: {}", deviceId);
            return new ArrayList<>();
        }

        return buildPlaylistItemDTOs(playlistEntries.stream()
                .map(StoryPlaylistEntity::getContentId)
                .collect(Collectors.toList()), playlistEntries);
    }

    // ========== CREATE ==========

    @Override
    @Transactional(rollbackFor = Exception.class)
    public Integer addToMusicPlaylist(String macAddress, List<String> contentIds) {
        log.info("Adding {} songs to music playlist for MAC: {}", contentIds.size(), macAddress);

        DeviceEntity device = getDeviceOrThrow(macAddress);
        validateContentItems(contentIds, "music");

        // Get current max position
        Integer maxPosition = musicPlaylistDao.getMaxPosition(device.getId());
        int startPosition = (maxPosition == null) ? 0 : maxPosition + 1;

        // Create playlist entries
        List<MusicPlaylistEntity> entities = new ArrayList<>();
        for (int i = 0; i < contentIds.size(); i++) {
            MusicPlaylistEntity entity = new MusicPlaylistEntity();
            entity.setDeviceId(device.getId());
            entity.setContentId(contentIds.get(i));
            entity.setPosition(startPosition + i);
            entity.setCreatedAt(new Date());
            entity.setUpdatedAt(new Date());
            entities.add(entity);
        }

        int inserted = musicPlaylistDao.batchInsert(entities);
        log.info("Added {} songs to music playlist", inserted);
        return inserted;
    }

    @Override
    @Transactional(rollbackFor = Exception.class)
    public Integer addToStoryPlaylist(String macAddress, List<String> contentIds) {
        log.info("Adding {} stories to story playlist for MAC: {}", contentIds.size(), macAddress);

        DeviceEntity device = getDeviceOrThrow(macAddress);
        validateContentItems(contentIds, "story");

        Integer maxPosition = storyPlaylistDao.getMaxPosition(device.getId());
        int startPosition = (maxPosition == null) ? 0 : maxPosition + 1;

        List<StoryPlaylistEntity> entities = new ArrayList<>();
        for (int i = 0; i < contentIds.size(); i++) {
            StoryPlaylistEntity entity = new StoryPlaylistEntity();
            entity.setDeviceId(device.getId());
            entity.setContentId(contentIds.get(i));
            entity.setPosition(startPosition + i);
            entity.setCreatedAt(new Date());
            entity.setUpdatedAt(new Date());
            entities.add(entity);
        }

        int inserted = storyPlaylistDao.batchInsert(entities);
        log.info("Added {} stories to story playlist", inserted);
        return inserted;
    }

    // ========== UPDATE ==========

    @Override
    @Transactional(rollbackFor = Exception.class)
    public Integer replaceMusicPlaylist(String macAddress, List<String> contentIds) {
        log.info("Replacing music playlist for MAC: {} with {} songs", macAddress, contentIds.size());

        DeviceEntity device = getDeviceOrThrow(macAddress);
        validateContentItems(contentIds, "music");

        // Delete old playlist
        musicPlaylistDao.deleteByDeviceId(device.getId());

        // Insert new playlist
        if (contentIds.isEmpty()) {
            return 0;
        }

        List<MusicPlaylistEntity> entities = new ArrayList<>();
        for (int i = 0; i < contentIds.size(); i++) {
            MusicPlaylistEntity entity = new MusicPlaylistEntity();
            entity.setDeviceId(device.getId());
            entity.setContentId(contentIds.get(i));
            entity.setPosition(i);
            entity.setCreatedAt(new Date());
            entity.setUpdatedAt(new Date());
            entities.add(entity);
        }

        int inserted = musicPlaylistDao.batchInsert(entities);
        log.info("Replaced music playlist with {} songs", inserted);
        return inserted;
    }

    @Override
    @Transactional(rollbackFor = Exception.class)
    public Integer replaceStoryPlaylist(String macAddress, List<String> contentIds) {
        log.info("Replacing story playlist for MAC: {} with {} stories", macAddress, contentIds.size());

        DeviceEntity device = getDeviceOrThrow(macAddress);
        validateContentItems(contentIds, "story");

        storyPlaylistDao.deleteByDeviceId(device.getId());

        if (contentIds.isEmpty()) {
            return 0;
        }

        List<StoryPlaylistEntity> entities = new ArrayList<>();
        for (int i = 0; i < contentIds.size(); i++) {
            StoryPlaylistEntity entity = new StoryPlaylistEntity();
            entity.setDeviceId(device.getId());
            entity.setContentId(contentIds.get(i));
            entity.setPosition(i);
            entity.setCreatedAt(new Date());
            entity.setUpdatedAt(new Date());
            entities.add(entity);
        }

        int inserted = storyPlaylistDao.batchInsert(entities);
        log.info("Replaced story playlist with {} stories", inserted);
        return inserted;
    }

    @Override
    @Transactional(rollbackFor = Exception.class)
    public Boolean reorderMusicPlaylist(String macAddress, List<PlaylistReorderRequest.ReorderItem> items) {
        log.info("Reordering music playlist for MAC: {}", macAddress);

        DeviceEntity device = getDeviceOrThrow(macAddress);

        for (PlaylistReorderRequest.ReorderItem item : items) {
            musicPlaylistDao.updatePosition(device.getId(), item.getContentId(), item.getPosition());
        }

        log.info("Reordered {} music playlist items", items.size());
        return true;
    }

    @Override
    @Transactional(rollbackFor = Exception.class)
    public Boolean reorderStoryPlaylist(String macAddress, List<PlaylistReorderRequest.ReorderItem> items) {
        log.info("Reordering story playlist for MAC: {}", macAddress);

        DeviceEntity device = getDeviceOrThrow(macAddress);

        for (PlaylistReorderRequest.ReorderItem item : items) {
            storyPlaylistDao.updatePosition(device.getId(), item.getContentId(), item.getPosition());
        }

        log.info("Reordered {} story playlist items", items.size());
        return true;
    }

    // ========== DELETE ==========

    @Override
    @Transactional(rollbackFor = Exception.class)
    public Integer removeFromMusicPlaylist(String macAddress, String contentId) {
        log.info("Removing song {} from music playlist for MAC: {}", contentId, macAddress);

        DeviceEntity device = getDeviceOrThrow(macAddress);

        // Get the position of the item being deleted
        List<MusicPlaylistEntity> playlist = musicPlaylistDao.getPlaylistByDeviceId(device.getId());
        Integer deletedPosition = playlist.stream()
                .filter(item -> item.getContentId().equals(contentId))
                .map(MusicPlaylistEntity::getPosition)
                .findFirst()
                .orElse(null);

        if (deletedPosition == null) {
            log.warn("Content {} not found in playlist", contentId);
            return musicPlaylistDao.countByDeviceId(device.getId());
        }

        // Delete the item
        musicPlaylistDao.deleteByDeviceAndContent(device.getId(), contentId);

        // Shift positions down to fill the gap
        musicPlaylistDao.shiftPositionsDown(device.getId(), deletedPosition);

        int remaining = musicPlaylistDao.countByDeviceId(device.getId());
        log.info("Removed song, {} songs remaining", remaining);
        return remaining;
    }

    @Override
    @Transactional(rollbackFor = Exception.class)
    public Integer removeFromStoryPlaylist(String macAddress, String contentId) {
        log.info("Removing story {} from story playlist for MAC: {}", contentId, macAddress);

        DeviceEntity device = getDeviceOrThrow(macAddress);

        List<StoryPlaylistEntity> playlist = storyPlaylistDao.getPlaylistByDeviceId(device.getId());
        Integer deletedPosition = playlist.stream()
                .filter(item -> item.getContentId().equals(contentId))
                .map(StoryPlaylistEntity::getPosition)
                .findFirst()
                .orElse(null);

        if (deletedPosition == null) {
            log.warn("Content {} not found in playlist", contentId);
            return storyPlaylistDao.countByDeviceId(device.getId());
        }

        storyPlaylistDao.deleteByDeviceAndContent(device.getId(), contentId);
        storyPlaylistDao.shiftPositionsDown(device.getId(), deletedPosition);

        int remaining = storyPlaylistDao.countByDeviceId(device.getId());
        log.info("Removed story, {} stories remaining", remaining);
        return remaining;
    }

    @Override
    @Transactional(rollbackFor = Exception.class)
    public Boolean clearMusicPlaylist(String macAddress) {
        log.info("Clearing music playlist for MAC: {}", macAddress);

        DeviceEntity device = getDeviceOrThrow(macAddress);
        int deleted = musicPlaylistDao.deleteByDeviceId(device.getId());

        log.info("Cleared {} songs from music playlist", deleted);
        return true;
    }

    @Override
    @Transactional(rollbackFor = Exception.class)
    public Boolean clearStoryPlaylist(String macAddress) {
        log.info("Clearing story playlist for MAC: {}", macAddress);

        DeviceEntity device = getDeviceOrThrow(macAddress);
        int deleted = storyPlaylistDao.deleteByDeviceId(device.getId());

        log.info("Cleared {} stories from story playlist", deleted);
        return true;
    }

    // ========== HELPER METHODS ==========

    private DeviceEntity getDeviceOrThrow(String macAddress) {
        DeviceEntity device = deviceService.getDeviceByMacAddress(macAddress);
        if (device == null) {
            throw new RenException("Device not found with MAC address: " + macAddress);
        }
        return device;
    }

    private void validateContentItems(List<String> contentIds, String expectedType) {
        if (contentIds == null || contentIds.isEmpty()) {
            throw new RenException("Content IDs list cannot be empty");
        }

        // Fetch all content items
        QueryWrapper<ContentItemsEntity> wrapper = new QueryWrapper<>();
        wrapper.in("id", contentIds);
        List<ContentItemsEntity> contentItems = contentItemsDao.selectList(wrapper);

        if (contentItems.size() != contentIds.size()) {
            throw new RenException("Some content items not found");
        }

        // Validate content type
        boolean invalidType = contentItems.stream()
                .anyMatch(item -> !expectedType.equalsIgnoreCase(item.getContentType()));

        if (invalidType) {
            throw new RenException("All content items must be of type: " + expectedType);
        }
    }

    private <T> List<PlaylistItemDTO> buildPlaylistItemDTOs(List<String> contentIds, List<T> playlistEntries) {
        // Fetch content items in bulk
        QueryWrapper<ContentItemsEntity> wrapper = new QueryWrapper<>();
        wrapper.in("id", contentIds);
        List<ContentItemsEntity> contentItems = contentItemsDao.selectList(wrapper);

        // Create a map for quick lookup
        Map<String, ContentItemsEntity> contentMap = contentItems.stream()
                .collect(Collectors.toMap(ContentItemsEntity::getId, item -> item));

        // Build result list maintaining playlist order
        List<PlaylistItemDTO> result = new ArrayList<>();
        for (T entry : playlistEntries) {
            String contentId;
            Integer position;
            Date createdAt;
            Date updatedAt;

            if (entry instanceof MusicPlaylistEntity) {
                MusicPlaylistEntity musicEntry = (MusicPlaylistEntity) entry;
                contentId = musicEntry.getContentId();
                position = musicEntry.getPosition();
                createdAt = musicEntry.getCreatedAt();
                updatedAt = musicEntry.getUpdatedAt();
            } else {
                StoryPlaylistEntity storyEntry = (StoryPlaylistEntity) entry;
                contentId = storyEntry.getContentId();
                position = storyEntry.getPosition();
                createdAt = storyEntry.getCreatedAt();
                updatedAt = storyEntry.getUpdatedAt();
            }

            ContentItemsEntity content = contentMap.get(contentId);
            if (content != null) {
                PlaylistItemDTO dto = new PlaylistItemDTO();
                dto.setContentId(content.getId());
                dto.setTitle(content.getTitle());
                dto.setRomanized(content.getRomanized());
                dto.setFilename(content.getFilename());
                dto.setCategory(content.getCategory());
                dto.setPosition(position);
                dto.setDurationSeconds(content.getDurationSeconds());
                dto.setThumbnailUrl(content.getThumbnailUrl());
                dto.setCreatedAt(createdAt);
                dto.setUpdatedAt(updatedAt);
                result.add(dto);
            } else {
                log.warn("Content item not found for ID: {}", contentId);
            }
        }

        return result;
    }
}
