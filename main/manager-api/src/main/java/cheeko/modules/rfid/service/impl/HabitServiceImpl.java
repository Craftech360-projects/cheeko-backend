package cheeko.modules.rfid.service.impl;

import java.util.ArrayList;
import java.util.List;

import org.springframework.stereotype.Service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;

import lombok.AllArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import cheeko.modules.rfid.dao.HabitDao;
import cheeko.modules.rfid.dao.HabitPackDao;
import cheeko.modules.rfid.dao.HabitStepDao;
import cheeko.modules.rfid.dao.RfidCardMappingDao;
import cheeko.modules.rfid.dto.HabitDownloadDTO;
import cheeko.modules.rfid.dto.HabitStepDTO;
import cheeko.modules.rfid.entity.HabitEntity;
import cheeko.modules.rfid.entity.HabitPackEntity;
import cheeko.modules.rfid.entity.HabitStepEntity;
import cheeko.modules.rfid.entity.RfidCardMappingEntity;
import cheeko.modules.rfid.service.HabitService;

/**
 * Habit Service Implementation
 */
@Slf4j
@AllArgsConstructor
@Service
public class HabitServiceImpl implements HabitService {

    private final HabitDao habitDao;
    private final HabitPackDao habitPackDao;
    private final HabitStepDao habitStepDao;
    private final RfidCardMappingDao rfidCardMappingDao;
    private final ObjectMapper objectMapper;

    @Override
    public HabitEntity getById(Long habitId) {
        return habitDao.selectById(habitId);
    }

    @Override
    public HabitEntity getByHabitCode(String habitCode) {
        return habitDao.getByHabitCode(habitCode);
    }

    @Override
    public HabitDownloadDTO getDownloadManifest(String rfidUid, String currentVersion, String currentHash) {
        if (rfidUid == null || rfidUid.trim().isEmpty()) {
            log.warn("getDownloadManifest called with empty rfidUid");
            return null;
        }

        // Look up the RFID card mapping
        RfidCardMappingEntity mapping = rfidCardMappingDao.getByRfidUid(rfidUid.trim());
        if (mapping == null) {
            log.info("No RFID mapping found for UID: {}", rfidUid);
            return null;
        }

        // Check if this card is linked to a habit
        Long habitId = mapping.getHabitId();
        if (habitId == null) {
            log.info("RFID card {} is not linked to a habit", rfidUid);
            return null;
        }

        return getDownloadManifestByHabitId(habitId, rfidUid);
    }

    @Override
    public HabitDownloadDTO getDownloadManifestByHabitId(Long habitId, String rfidUid) {
        // Get the habit
        HabitEntity habit = habitDao.selectById(habitId);
        if (habit == null || !Boolean.TRUE.equals(habit.getActive())) {
            log.info("Habit not found or inactive: {}", habitId);
            return null;
        }

        // Get the habit pack for version info
        HabitPackEntity pack = habitPackDao.selectById(habit.getPackId());

        // Get all steps for this habit
        List<HabitStepEntity> steps = habitStepDao.getByHabitId(habitId);

        // Convert steps to DTOs
        List<HabitStepDTO> stepDtos = new ArrayList<>();
        for (HabitStepEntity step : steps) {
            HabitStepDTO stepDto = convertStepToDto(step);
            stepDtos.add(stepDto);
        }

        // Build the response
        HabitDownloadDTO dto = new HabitDownloadDTO();
        dto.setRfidUid(rfidUid);
        dto.setContentType("habit");
        dto.setHabitCode(habit.getHabitCode());
        dto.setHabitName(habit.getName());
        dto.setVersion(pack != null ? pack.getVersion() : "1.0.0");
        dto.setContentHash(pack != null ? pack.getContentHash() : null);
        dto.setTotalSteps(habit.getTotalSteps());
        dto.setThumbnailUrl(habit.getThumbnailUrl());
        dto.setSteps(stepDtos);

        return dto;
    }

    /**
     * Convert a step entity to DTO, parsing the images JSON
     */
    private HabitStepDTO convertStepToDto(HabitStepEntity step) {
        HabitStepDTO dto = new HabitStepDTO();
        dto.setStepNumber(step.getStepNumber());
        dto.setTitle(step.getTitle());
        dto.setInstructionText(step.getInstructionText());

        // Audio info
        if (step.getAudioUrl() != null) {
            HabitStepDTO.AudioInfo audio = new HabitStepDTO.AudioInfo();
            audio.setUrl(step.getAudioUrl());
            audio.setSizeBytes(step.getAudioSizeBytes());
            audio.setDurationMs(step.getAudioDurationMs());
            dto.setAudio(audio);
        }

        // Parse images JSON
        if (step.getImagesJson() != null && !step.getImagesJson().isEmpty()) {
            try {
                List<HabitStepDTO.ImageInfo> images = objectMapper.readValue(
                    step.getImagesJson(),
                    new TypeReference<List<HabitStepDTO.ImageInfo>>() {}
                );
                dto.setImages(images);
            } catch (Exception e) {
                log.error("Failed to parse images JSON for step {}: {}", step.getId(), e.getMessage());
                dto.setImages(new ArrayList<>());
            }
        } else {
            dto.setImages(new ArrayList<>());
        }

        return dto;
    }
}
