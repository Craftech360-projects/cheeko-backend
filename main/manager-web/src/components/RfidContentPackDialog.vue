<template>
  <el-dialog :title="title"
    :visible.sync="visible"
    width="600px"
    class="rfid-dialog-wrapper"
    :append-to-body="true"
    :close-on-click-modal="dismissOnBackdrop"
    @open="markPristine"
    @close="cancel"
    :key="dialogKey"
    custom-class="custom-rfid-dialog"
    :show-close="false"
  >
    <div class="dialog-container" ref="scroller">
      <div class="dialog-header">
        <h2 class="dialog-title">{{ title }}</h2>
        <button class="custom-close-btn" @click="cancel">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M13 1L1 13M1 1L13 13" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
          </svg>
        </button>
      </div>

      <el-form :model="form" :rules="rules" ref="form" label-width="130px" label-position="left" class="rfid-form">
        <el-form-item label="Pack Code" prop="packCode" class="form-item">
          <el-input v-model="form.packCode" placeholder="e.g., AB123456" maxlength="8" show-word-limit class="custom-input"></el-input>
        </el-form-item>

        <el-form-item label="Name" prop="name" class="form-item">
          <el-input v-model="form.name" placeholder="Display name" class="custom-input"></el-input>
        </el-form-item>

        <el-form-item label="Description" prop="description" class="form-item">
          <el-input type="textarea" v-model="form.description" placeholder="Content pack description" :rows="2" class="custom-textarea"></el-input>
        </el-form-item>

        <el-form-item label="Thumbnail Url" prop="thumbnailUrl" class="form-item">
          <div class="thumbnail-field">
            <el-input v-model="form.thumbnailUrl" placeholder="https://..." class="custom-input">
              <template slot="append">
                <el-button
                  icon="el-icon-upload2"
                  :loading="uploadingMedia"
                  @click="pickPackThumbnailFile"
                ></el-button>
              </template>
            </el-input>
            <div v-if="form.thumbnailUrl" class="thumbnail-preview-box">
              <img v-if="previewSrc(form.thumbnailUrl)"
                   :src="previewSrc(form.thumbnailUrl)"
                   alt="Thumbnail preview"
                   @error="markPreviewFailed(form.thumbnailUrl)"/>
              <div v-else-if="!previewLoading(form.thumbnailUrl)" class="thumbnail-preview-error">
                <i class="el-icon-picture-outline"></i>
              </div>
            </div>
          </div>
        </el-form-item>

        <el-form-item label="Content Type" prop="contentType" class="form-item">
          <el-select
            v-model="form.contentType"
            placeholder="Select a playlist"
            class="custom-select"
            filterable
            allow-create
            default-first-option
            @change="onContentTypeChange">
            <el-option
              :value="CREATE_SENTINEL"
              label="Create playlist…"
              class="create-playlist-option">
              <i class="el-icon-plus"></i> Create playlist…
            </el-option>
            <el-option
              v-for="opt in contentTypeOptions"
              :key="opt.value"
              :label="opt.label"
              :value="opt.value"/>
          </el-select>

          <div v-if="creatingType" class="new-playlist">
            <el-input
              ref="newPlaylistInput"
              v-model="newPlaylistName"
              placeholder="Playlist name, e.g. Festival Specials"
              maxlength="50"
              class="custom-input"
              @keyup.enter.native="confirmNewPlaylist"
              @keyup.esc.native="cancelNewPlaylist" />
            <el-button type="primary" size="small" @click="confirmNewPlaylist">Create</el-button>
            <el-button size="small" @click="cancelNewPlaylist">Cancel</el-button>
          </div>
          <span v-if="creatingType" class="field-hint">
            Saved as <b>{{ newPlaylistSlug || '…' }}</b>. The playlist appears in this list and in the
            Content Packs filter straight away; it holds packs once you save this one into it.
          </span>
          <span v-else class="field-hint">Pick a playlist, or choose “Create playlist…” to start a new one.</span>
        </el-form-item>

        <el-form-item label="Language" prop="language" class="form-item">
          <el-select v-model="form.language" placeholder="Select language" class="custom-select">
            <el-option label="English" value="en"/>
            <el-option label="Hindi" value="hi"/>
          </el-select>
        </el-form-item>

        <el-form-item label="Status" prop="status" class="form-item">
          <el-radio-group v-model="form.status" size="small">
            <el-radio-button label="draft">Draft</el-radio-button>
            <el-radio-button label="published">Published</el-radio-button>
          </el-radio-group>
        </el-form-item>

        <el-form-item label="Version" class="form-item">
           <span class="version-value">v{{ form.version || 1 }}</span>
           <span class="field-hint">Advances by one each time you save a change. The toy re-downloads the pack when it moves.</span>
        </el-form-item>

        <!-- Story Grouping Toggle -->
        <el-form-item label="Group by Stories" class="form-item">
          <el-switch v-model="storyMode" active-text="Grouped" inactive-text="Flat" :disabled="isSoundQuiz" @change="onStoryModeChange"></el-switch>
          <span class="story-mode-hint">{{ storyMode ? 'Items grouped into stories. Encoder rotates between stories.' : 'Flat list. Encoder rotates between individual tracks.' }}</span>
        </el-form-item>

        <!-- ========== FLAT MODE (existing) ========== -->
        <div class="items-section" v-if="!storyMode">
           <div class="items-header">
              <span class="items-title">Pack Items (Max {{ maxItems }})</span>
              <div class="items-header-actions">
                <el-button
                  size="mini"
                  icon="el-icon-folder-opened"
                  :loading="importing"
                  :disabled="importing || isSoundQuiz || form.items.length >= maxItems"
                  @click="pickFolder">
                  {{ importing ? `Uploading ${importDone}/${importTotal}` : 'Import Folder' }}
                </el-button>
                <el-button
                  size="mini"
                  class="replace-btn"
                  title="Replace all items with a folder"
                  aria-label="Replace all items with a folder"
                  :disabled="importing || isSoundQuiz || form.items.length === 0"
                  @click="pickFolder('replace')">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/>
                    <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
                  </svg>
                </el-button>
                <el-button
                  size="mini"
                  class="download-btn"
                  title="Download all items as a folder (.zip)"
                  aria-label="Download all items as a folder"
                  :loading="downloading"
                  :disabled="downloading || form.items.length === 0"
                  @click="downloadFolder">
                  <svg v-if="!downloading" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
                  </svg>
                </el-button>
                <el-button size="mini" type="primary" icon="el-icon-plus" @click="addItem()" :disabled="importing || form.items.length >= maxItems">Add Item</el-button>
              </div>
           </div>

           <div class="items-list" :class="{ 'is-dragging': dragFrom !== null }">
            <template v-for="(item, index) in form.items">
              <div :key="'insert-' + item._rowKey" class="insert-divider">
                <button
                  type="button"
                  class="insert-here"
                  :disabled="importing || form.items.length >= maxItems"
                  @click="addItem(index)">
                  + Add item here
                </button>
              </div>
              <div :key="item._rowKey"
                   class="item-row"
                   :class="rowDragClass(index)"
                   :draggable="armedRow === item._rowKey"
                   @dragstart="onRowDragStart(index, $event)"
                   @dragover.prevent="onRowDragOver(index)"
                   @drop.prevent="onRowDrop(index)"
                   @dragend="endRowDrag">
                  <div class="item-col seq-col">
                     <span class="seq-badge">{{ index + 1 }}</span>
                     <span class="drag-handle"
                           title="Drag to reorder"
                           @mousedown="armedRow = item._rowKey"
                           @mouseup="armedRow = null">
                       <svg width="10" height="16" viewBox="0 0 10 16" aria-hidden="true">
                         <circle cx="2" cy="3" r="1.3"/><circle cx="8" cy="3" r="1.3"/>
                         <circle cx="2" cy="8" r="1.3"/><circle cx="8" cy="8" r="1.3"/>
                         <circle cx="2" cy="13" r="1.3"/><circle cx="8" cy="13" r="1.3"/>
                       </svg>
                     </span>
                  </div>
                  <div class="item-col main-col">
                      <div class="inputs-wrapper" style="flex: 1; min-width: 0;">
                          <el-input v-model="item.title" :placeholder="isSoundQuiz ? 'Sound (e.g. Doorbell)' : 'Title'" size="small" class="mb-1"></el-input>
                          <el-input v-if="isSoundQuiz" v-model="item.text" placeholder="Prompt shown on the toy (e.g. DING-DONG?)" size="small" class="mb-1">
                              <template slot="prepend"><i class="el-icon-chat-dot-square"></i></template>
                          </el-input>
                          <el-input v-model="item.audioUrl" :placeholder="isSoundQuiz ? 'Sound file (MP3, 22050 Hz mono)' : 'Audio URL (https://...)'" size="small" class="mb-1">
                              <template slot="prepend"><i class="el-icon-headset"></i></template>
                              <template slot="append">
                                <el-button
                                  icon="el-icon-upload2"
                                  :loading="uploadingMedia"
                                  @click="pickAudioFile(index)"
                                ></el-button>
                                <el-button
                                  v-if="item.audioUrl"
                                  :icon="playingUrl === item.audioUrl ? 'el-icon-video-pause' : 'el-icon-video-play'"
                                  @click="toggleAudio(item.audioUrl)"
                                ></el-button>
                              </template>
                          </el-input>
                          <el-input v-model="item.imageUrl" :placeholder="isSoundQuiz ? 'Icon (48x48 PNG)' : 'Image URL (Thumbnail)'" size="small" class="mb-1">
                               <template slot="prepend"><i class="el-icon-picture"></i></template>
                               <template slot="append">
                                 <el-button
                                   icon="el-icon-upload2"
                                   :loading="uploadingMedia"
                                   @click="pickImageFile(index)"
                                 ></el-button>
                               </template>
                          </el-input>
                          <div v-if="isSoundQuiz" class="distractor-row">
                            <el-select :value="distractorAt(item, 0)" @input="setDistractor(item, 0, $event)" placeholder="Wrong answer 1" size="small" clearable filterable>
                              <el-option v-for="name in distractorOptions(index)" :key="'d0-' + name" :label="name" :value="name"/>
                            </el-select>
                            <el-select :value="distractorAt(item, 1)" @input="setDistractor(item, 1, $event)" placeholder="Wrong answer 2" size="small" clearable filterable>
                              <el-option v-for="name in distractorOptions(index)" :key="'d1-' + name" :label="name" :value="name"/>
                            </el-select>
                          </div>
                          <el-input v-else type="textarea" v-model="item.text" placeholder="Voice script / Text content" size="small" :rows="2" class="text-input">
                          </el-input>
                      </div>
                      <div v-if="item.imageUrl" class="img-preview-box">
                           <img v-if="previewSrc(item.imageUrl)" :src="previewSrc(item.imageUrl)" alt="Preview" @error="markPreviewFailed(item.imageUrl)"/>
                           <div v-else-if="previewLoading(item.imageUrl)" class="bin-loading">
                             <i class="el-icon-loading"></i>
                           </div>
                           <div v-else class="bin-error">
                             <i class="el-icon-picture-outline"></i>
                             <span>No preview</span>
                           </div>
                      </div>
                  </div>
                  <div class="item-col action-col">
                      <el-button type="text" icon="el-icon-delete" class="text-danger" @click="removeItem(index)"></el-button>
                  </div>
              </div>
            </template>
              <div v-if="form.items.length === 0" class="empty-items">
                  No items added. Click "Add Item" to start.
              </div>
           </div>
        </div>

        <!-- ========== STORY MODE (grouped) ========== -->
        <div class="items-section" v-if="storyMode">
           <div class="items-header">
              <span class="items-title">Stories (Max {{ maxItems }} tracks each)</span>
              <div class="items-header-actions">
                <el-button
                  size="mini"
                  icon="el-icon-folder-opened"
                  :loading="importing"
                  :disabled="importing || isSoundQuiz || !stories[selectedStory] || stories[selectedStory].items.length >= maxItems"
                  @click="pickFolder">
                  {{ importing ? `Uploading ${importDone}/${importTotal}` : 'Import Folder' }}
                </el-button>
                <el-button
                  size="mini"
                  class="replace-btn"
                  title="Replace the selected story's tracks with a folder"
                  aria-label="Replace the selected story's tracks with a folder"
                  :disabled="importing || isSoundQuiz || !(stories[selectedStory] && stories[selectedStory].items.length)"
                  @click="pickFolder('replace')">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/>
                    <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
                  </svg>
                </el-button>
                <el-button
                  size="mini"
                  class="download-btn"
                  title="Download the selected story as a folder (.zip)"
                  aria-label="Download the selected story as a folder"
                  :loading="downloading"
                  :disabled="downloading || !(stories[selectedStory] && stories[selectedStory].items.length)"
                  @click="downloadFolder">
                  <svg v-if="!downloading" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
                  </svg>
                </el-button>
                <el-button size="mini" type="primary" icon="el-icon-plus" @click="addStory">Add Story</el-button>
              </div>
           </div>

           <div v-if="stories.length === 0" class="empty-items">
              No stories added. Click "Add Story" to start.
           </div>

           <div v-for="(story, sIndex) in stories" :key="'story-' + sIndex" class="story-block"
                :class="{ 'is-selected': selectedStory === sIndex }"
                @mousedown="selectStory(sIndex)">
              <div class="story-header">
                <div class="story-header-left">
                  <span class="story-badge">Story {{ sIndex + 1 }}</span>
                  <el-input v-model="story.title" placeholder="Story title (e.g., The Lion King)" size="small" class="story-title-input"></el-input>
                </div>
                <div class="story-header-right">
                  <!-- Folder actions for this story. Each selects its story first,
                       so it acts on this one whichever story was selected before.
                       The span lets the tooltip show on a disabled button. -->
                  <el-tooltip content="Upload folder" placement="top" :open-delay="200">
                    <span class="story-action">
                      <el-button
                        size="mini"
                        class="icon-btn"
                        aria-label="Upload a folder into this story"
                        :disabled="importing || isSoundQuiz || story.items.length >= maxItems"
                        @click="selectStory(sIndex); pickFolder()">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                        </svg>
                      </el-button>
                    </span>
                  </el-tooltip>
                  <el-tooltip content="Replace tracks" placement="top" :open-delay="200">
                    <span class="story-action">
                      <el-button
                        size="mini"
                        class="icon-btn"
                        aria-label="Replace this story's tracks with a folder"
                        :disabled="importing || isSoundQuiz || story.items.length === 0"
                        @click="selectStory(sIndex); pickFolder('replace')">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                          <polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/>
                          <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
                        </svg>
                      </el-button>
                    </span>
                  </el-tooltip>
                  <el-tooltip content="Download tracks" placement="top" :open-delay="200">
                    <span class="story-action">
                      <el-button
                        size="mini"
                        class="icon-btn"
                        aria-label="Download this story as a folder"
                        :disabled="downloading || story.items.length === 0"
                        @click="selectStory(sIndex); downloadFolder()">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
                        </svg>
                      </el-button>
                    </span>
                  </el-tooltip>
                  <el-button size="mini" type="primary" icon="el-icon-plus" @click="addStoryItem(sIndex)" :disabled="importing || story.items.length >= maxItems" plain>Add Track</el-button>
                  <el-button size="mini" type="danger" icon="el-icon-delete" @click="removeStory(sIndex)" plain circle></el-button>
                </div>
              </div>

              <div class="story-items" :class="{ 'is-dragging': dragFrom !== null }">
                <template v-for="(item, iIndex) in story.items">
                <div :key="'insert-' + item._rowKey" class="insert-divider">
                  <button type="button" class="insert-here" :disabled="importing || story.items.length >= maxItems" @click="addStoryItem(sIndex, iIndex)">
                    + Add track here
                  </button>
                </div>
                <div :key="item._rowKey"
                     class="item-row"
                     :class="rowDragClass(iIndex, sIndex)"
                     :draggable="armedRow === item._rowKey"
                     @dragstart="onRowDragStart(iIndex, $event, sIndex)"
                     @dragover.prevent="onRowDragOver(iIndex, sIndex)"
                     @drop.prevent="onRowDrop(iIndex, sIndex)"
                     @dragend="endRowDrag">
                  <div class="item-col seq-col">
                    <span class="seq-badge">{{ iIndex + 1 }}</span>
                    <span class="drag-handle"
                          title="Drag to reorder"
                          @mousedown="armedRow = item._rowKey"
                          @mouseup="armedRow = null">
                      <svg width="10" height="16" viewBox="0 0 10 16" aria-hidden="true">
                        <circle cx="2" cy="3" r="1.3"/><circle cx="8" cy="3" r="1.3"/>
                        <circle cx="2" cy="8" r="1.3"/><circle cx="8" cy="8" r="1.3"/>
                        <circle cx="2" cy="13" r="1.3"/><circle cx="8" cy="13" r="1.3"/>
                      </svg>
                    </span>
                  </div>
                  <div class="item-col main-col">
                    <div class="inputs-wrapper" style="flex: 1; min-width: 0;">
                      <el-input v-model="item.title" placeholder="Track title" size="small" class="mb-1"></el-input>
                      <el-input v-model="item.audioUrl" placeholder="Audio URL (https://...)" size="small" class="mb-1">
                        <template slot="prepend"><i class="el-icon-headset"></i></template>
                        <template slot="append">
                          <el-button
                            icon="el-icon-upload2"
                            :loading="uploadingMedia"
                            @click="pickAudioFile(iIndex, sIndex)"
                          ></el-button>
                          <el-button
                            v-if="item.audioUrl"
                            :icon="playingUrl === item.audioUrl ? 'el-icon-video-pause' : 'el-icon-video-play'"
                            @click="toggleAudio(item.audioUrl)"
                          ></el-button>
                        </template>
                      </el-input>
                      <el-input v-model="item.imageUrl" placeholder="Image URL (Thumbnail)" size="small" class="mb-1">
                        <template slot="prepend"><i class="el-icon-picture"></i></template>
                        <template slot="append">
                          <el-button
                            icon="el-icon-upload2"
                            :loading="uploadingMedia"
                            @click="pickImageFile(iIndex, sIndex)"
                          ></el-button>
                        </template>
                      </el-input>
                      <el-input type="textarea" v-model="item.text" placeholder="Voice script / Text content" size="small" :rows="2" class="text-input"></el-input>
                    </div>
                    <div v-if="item.imageUrl" class="img-preview-box">
                      <img v-if="previewSrc(item.imageUrl)" :src="previewSrc(item.imageUrl)" alt="Preview" @error="markPreviewFailed(item.imageUrl)"/>
                      <div v-else-if="previewLoading(item.imageUrl)" class="bin-loading">
                        <i class="el-icon-loading"></i>
                      </div>
                      <div v-else class="bin-error">
                        <i class="el-icon-picture-outline"></i>
                        <span>No preview</span>
                      </div>
                    </div>
                  </div>
                  <div class="item-col action-col">
                    <el-button type="text" icon="el-icon-delete" class="text-danger" @click="removeStoryItem(sIndex, iIndex)"></el-button>
                  </div>
                </div>
                </template>
                <div v-if="story.items.length === 0" class="empty-items" style="padding: 10px;">
                  No tracks. Click "Add Track" above.
                </div>
              </div>
           </div>
        </div>
      </el-form>

      <input
        ref="audioFilePicker"
        type="file"
        accept=".mp3,.wav,.ogg,.m4a,audio/*"
        style="display: none"
        @change="handleAudioFileSelected"
      />
      <input
        ref="imageFilePicker"
        type="file"
        accept=".png,.jpg,.jpeg,.gif,.webp,.bin,image/*,application/octet-stream"
        style="display: none"
        @change="handleImageFileSelected"
      />
      <input
        ref="folderPicker"
        type="file"
        webkitdirectory
        directory
        multiple
        style="display: none"
        @change="handleFolderSelected"
      />

      <div class="dialog-footer">
        <el-button size="small" @click="cancel">Cancel</el-button>
        <el-button
          size="small"
          type="primary"
          :loading="saving"
          :disabled="saving"
          @click="submit">
          Save
        </el-button>
      </div>
    </div>
  </el-dialog>
</template>

<script>
import dialogDismiss from '@/mixins/dialogDismiss';
import Api from "@/apis/api";
import { pairMediaFiles, fileName } from "@/utils/pairMediaFiles.mjs";
import { MAX_TRACKS, roomFor } from "@/utils/trackLimit.mjs";
import { isBinUrl, lvglBinToDataUrl, loadLvglBinAsDataUrl } from "@/utils/lvglBin";
import { previewAudioObjectUrl } from "@/apis/module/rfid";
import {
  DEFAULT_CONTENT_TYPES,
  contentTypeLabel,
  customContentTypes,
  registerContentType,
  normalizeContentType
} from "@/utils/contentTypes";

// Picking this in the select opens the name field instead of setting a value.
const CREATE_SENTINEL = '__create_playlist__';

// How close to an edge of the scrolling dialog a dragged row has to get before
// the list starts moving under it, and how fast it travels once pinned there.
// The zone is deeper than a row is tall so it can be entered deliberately, and
// the speed is per frame — roughly 1000px/s at the edge, which crosses a
// ten-item pack in about a second.
const AUTO_SCROLL_EDGE = 72;
const AUTO_SCROLL_MAX_STEP = 17;

// A row identity that survives reordering. The array index cannot be it — moving
// a row would hand its inputs to whoever took its place — and the database id
// cannot either, because a row added in
// this dialog has none until it is saved. Stripped from the payload on submit.
let rowKeySeed = 0;
const nextRowKey = () => `row-${++rowKeySeed}`;
const stripRowKey = ({ _rowKey, ...item }) => item;

export default {
  mixins: [dialogDismiss],
  props: {
    title: {
      type: String,
      default: 'Add Content Pack'
    },
    visible: {
      type: Boolean,
      default: false
    },
    form: {
      type: Object,
      default: () => ({
        packCode: '',
        name: '',
        description: '',
        contentType: 'story_pack', // Default to story pack
        language: 'en',
        status: 'draft',
        version: 1,
        active: true,
        thumbnailUrl: '',
        items: [] // Structured Items
      })
    }
  },
  data() {
    return {
      dialogKey: Date.now(),
      saving: false,
      currentAudio: null,
      currentObjectUrl: null,
      playingUrl: null,
      storyMode: false,
      stories: [],  // [{title: '', items: [{title, audioUrl, imageUrl, text}]}]
      selectedStory: null, // index of the story a grouped-mode folder import goes into
      pendingUpload: null, // { mode: 'flat'|'story'|'packThumbnail', storyIndex, itemIndex, field: 'audioUrl'|'imageUrl'|'thumbnailUrl' }
      _ensurePackIdPromise: null, // in-flight create+lookup, shared so two files picked at once can't create two packs
      uploadingMedia: false,
      importing: false,
      folderAction: 'import', // 'import' adds the folder's tracks, 'replace' swaps them in
      downloading: false,
      importDone: 0,
      importTotal: 0,
      knownContentTypes: [],
      // Playlists created from this dialog, so an empty one stays selectable
      createdTypes: [],
      creatingType: false,
      newPlaylistName: "",
      lastContentType: "",
      // Artwork previews, keyed by URL rather than by row. Every upload gets a
      // URL of its own, so a replaced or edited picture is a new key and a new
      // preview — never the previous one left on screen. `binPreviews` holds a
      // decoded `.bin` as a PNG data URL (null while it loads); `failedPreviews`
      // marks any URL, web image or `.bin`, that could not be shown.
      binPreviews: {},
      failedPreviews: {},
      // Reordering by drag. `armedRow` is the row whose handle is under the
      // mouse: rows are only draggable while it names them, so the title and
      // URL fields stay selectable everywhere else. `dragFrom`/`dragOver` are
      // the row in flight and the row it is currently over, and `dragStory` is
      // the story it belongs to — a track can be dragged within its own story,
      // not into another one, because moving between stories would change which
      // story it is rather than where it sits.
      armedRow: null,
      dragFrom: null,
      dragOver: null,
      dragStory: null,
      rules: {
        packCode: [
          { required: true, message: "Please enter pack code", trigger: "blur" },
          { max: 8, message: "Pack code must be 8 characters or less", trigger: "blur" },
          {
            validator: (rule, value, callback) => {
              if (this.isSoundQuiz && !/^[a-z0-9_-]{1,8}$/.test(String(value || ''))) {
                callback(new Error('Game pack code: 1-8 chars, a-z 0-9 _ - (it becomes the SD folder)'));
              } else {
                callback();
              }
            },
            trigger: 'blur'
          }
        ],
        name: [
          { required: true, message: "Please enter name", trigger: "blur" }
        ],
        contentType: [
          { required: true, message: "Please select or create a content type", trigger: "change" },
          { max: 50, message: "Content type must be 50 characters or less", trigger: "change" }
        ]
      }
    };
  },
  computed: {
    CREATE_SENTINEL: () => CREATE_SENTINEL,

    // Shipped types + every type already used by a saved pack + playlists
    // created from this dialog + whatever the form currently holds, so a
    // playlist stays selectable even before any pack has been saved into it.
    contentTypeOptions() {
      const values = new Set(DEFAULT_CONTENT_TYPES);
      this.knownContentTypes.forEach(t => values.add(t));
      this.createdTypes.forEach(t => values.add(t.value));
      if (this.form.contentType) values.add(this.form.contentType);
      return [...values].map(value => ({ value, label: contentTypeLabel(value) }));
    },

    // Sound-quiz packs are game packs: rows are quiz rounds, files are stored
    // as-is, and the pack code becomes the SD folder (8.3).
    isSoundQuiz() {
      return this.normalizeContentType(this.form.contentType) === 'sound_quiz';
    },

    // A sound quiz is capped by the firmware's round limit (16), not the
    // skills track limit.
    maxItems() {
      return this.isSoundQuiz ? 16 : MAX_TRACKS;
    },

    newPlaylistSlug() {
      return normalizeContentType(this.newPlaylistName);
    }
  },
  methods: {
    // The story editor writes to `stories`, not to `form.items`, so the
    // baseline has to cover it or a whole authored story reads as untouched.
    dirtyState() {
      return { form: this.form, storyMode: this.storyMode, stories: this.stories };
    },

    // Keeps created types in the snake_case shape every existing value uses, so
    // "Music Pack" cannot become a near-duplicate of an existing music_pack.
    normalizeContentType(value) {
      return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 50);
    },
    onContentTypeChange(value) {
      if (value === CREATE_SENTINEL) {
        // Never let the sentinel reach the form: restore what was selected and
        // open the name field instead.
        this.form.contentType = this.lastContentType || '';
        this.openNewPlaylist();
        return;
      }
      const normalized = this.normalizeContentType(value);
      this.form.contentType = normalized !== value ? normalized : value;
      this.lastContentType = this.form.contentType;
    },

    openNewPlaylist() {
      this.creatingType = true;
      this.newPlaylistName = '';
      this.$nextTick(() => {
        const input = this.$refs.newPlaylistInput;
        if (input && input.focus) input.focus();
      });
    },

    cancelNewPlaylist() {
      this.creatingType = false;
      this.newPlaylistName = '';
    },

    confirmNewPlaylist() {
      const label = String(this.newPlaylistName || '').trim();
      if (!label) {
        this.$message.warning('Give the playlist a name.');
        return;
      }

      const value = this.normalizeContentType(label);
      if (!value) {
        this.$message.warning('That name has no letters or numbers to save.');
        return;
      }

      const existing = this.contentTypeOptions.find(opt => opt.value === value);
      if (existing) {
        // Same slug as something that already exists — select it rather than
        // creating a near-duplicate the filter would show twice.
        this.form.contentType = value;
        this.lastContentType = value;
        this.creatingType = false;
        this.newPlaylistName = '';
        this.$message.info(`“${existing.label}” already exists — selected it.`);
        return;
      }

      const created = registerContentType(label);
      if (!created) return;

      this.createdTypes = [...this.createdTypes, created];
      this.form.contentType = created.value;
      this.lastContentType = created.value;
      this.creatingType = false;
      this.newPlaylistName = '';
      this.$message.success(`Playlist “${created.label}” created.`);
      // Lets the pack list refresh its filter without waiting for a save
      this.$emit('content-type-created', created);
    },
    loadContentTypes() {
      this.createdTypes = customContentTypes();
      Api.rfid.getContentPackList(({ data }) => {
        if (data?.code !== 0) return;
        this.knownContentTypes = [...new Set(
          (data.data || []).map(pack => pack.contentType).filter(Boolean)
        )];
      });
    },
    // Every row carries a key of its own, assigned once. Rows loaded from the API
    // get theirs when the dialog opens; rows created here get theirs at creation.
    ensureRowKeys(items) {
        (items || []).forEach(item => {
            if (!item._rowKey) this.$set(item, '_rowKey', nextRowKey());
        });
    },
    // item_number is the pack's running order, and the array is the only thing
    // that knows it, so it is rewritten from array position after every
    // insertion, deletion and move: index 0 → 1, index 1 → 2, no gaps, no
    // duplicates. submit() stamps itemNumber the same way.
    resequence(items) {
        items.forEach((item, idx) => { item.sequence = idx + 1; });
    },
    // `index` is the position to insert at; omitted, the item goes on the end.
    addItem(index = null) {
        if (this.form.items.length >= this.maxItems) return;
        const item = {
            _rowKey: nextRowKey(),
            sequence: 0,
            title: '',
            audioUrl: '',
            imageUrl: '',
            text: '',  // Voice script / lyrics text — the Prompt for a sound quiz
            description: ''  // Sound quiz: "A,B" wrong-answer Sound names
        };
        if (index === null || index >= this.form.items.length) {
            this.form.items.push(item);
        } else {
            this.form.items.splice(index, 0, item);
        }
        this.resequence(this.form.items);
    },
    // Moves a row to a position. splice moves the same object, so its database
    // id and every field it holds travel with it.
    moveWithin(items, from, to) {
        if (from === to || to < 0 || to >= items.length) return;
        const [moved] = items.splice(from, 1);
        items.splice(to, 0, moved);
        this.resequence(items);
    },
    removeItem(index) {
        this.form.items.splice(index, 1);
        // Re-sequence
        this.resequence(this.form.items);
    },
    // ---- Sound quiz: wrong answers live in `description` as "A,B" ----
    // Positional: slot 1 may be filled before slot 0, and clearing slot 0 must
    // not slide slot 1 left, so empties are kept here and only dropped when
    // validating.
    distractorSlots(item) {
      const slots = String(item.description || '').split(',').map(s => s.trim());
      while (slots.length < 2) slots.push('');
      return slots.slice(0, 2);
    },
    distractorList(item) {
      return this.distractorSlots(item).filter(Boolean);
    },
    distractorAt(item, idx) {
      return this.distractorSlots(item)[idx] || '';
    },
    setDistractor(item, idx, value) {
      const slots = this.distractorSlots(item);
      slots[idx] = value || '';
      this.$set(item, 'description', slots.join(','));
    },
    // Every other row's Sound name. A round cannot be its own wrong answer.
    distractorOptions(index) {
      return this.form.items
        .filter((it, i) => i !== index && String(it.title || '').trim())
        .map(it => it.title.trim());
    },
    // ---- Story Mode Methods ----
    onStoryModeChange(val) {
      this.selectedStory = null;
      if (val) {
        // Switching to story mode — convert flat items to a single story if any exist
        if (this.form.items.length > 0 && this.stories.length === 0) {
          this.stories = [{
            title: '',
            items: this.form.items.map(i => ({ ...i, _rowKey: nextRowKey() }))
          }];
        }
        if (this.stories.length === 0) {
          this.stories = [{ title: '', items: [] }];
        }
      }
    },
    addStory() {
      this.stories.push({ title: '', items: [] });
    },
    removeStory(sIndex) {
      this.stories.splice(sIndex, 1);
      // Keep the selection on the same story, or clear it if that one went.
      if (this.selectedStory === sIndex) this.selectedStory = null;
      else if (this.selectedStory > sIndex) this.selectedStory -= 1;
    },
    selectStory(sIndex) {
      this.selectedStory = sIndex;
    },
    // `iIndex` is the position to insert at; omitted, the track goes on the end.
    addStoryItem(sIndex, iIndex = null) {
      const items = this.stories[sIndex].items;
      if (items.length >= this.maxItems) return;
      const track = {
        _rowKey: nextRowKey(), title: '', audioUrl: '', imageUrl: '', text: ''
      };
      if (iIndex === null || iIndex >= items.length) {
        items.push(track);
      } else {
        items.splice(iIndex, 0, track);
      }
      this.resequence(items);
    },
    removeStoryItem(sIndex, iIndex) {
      this.stories[sIndex].items.splice(iIndex, 1);
      this.resequence(this.stories[sIndex].items);
    },
    // ---- Reordering by drag ----
    // The list a drag is happening in: the flat items, or one story's tracks.
    dragList(storyIndex = null) {
      return storyIndex === null ? this.form.items : this.stories[storyIndex].items;
    },
    onRowDragStart(index, event, storyIndex = null) {
      this.dragFrom = index;
      this.dragOver = index;
      this.dragStory = storyIndex;
      this.startAutoScroll();
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = 'move';
        // Firefox starts no drag at all unless the payload is set, and the row
        // is identified by position, so there is nothing useful to carry.
        event.dataTransfer.setData('text/plain', String(index));
      }
    },
    onRowDragOver(index, storyIndex = null) {
      if (this.dragFrom === null || storyIndex !== this.dragStory) return;
      this.dragOver = index;
    },
    onRowDrop(index, storyIndex = null) {
      if (this.dragFrom === null || storyIndex !== this.dragStory) return;
      this.moveWithin(this.dragList(storyIndex), this.dragFrom, index);
      this.endRowDrag();
    },
    endRowDrag() {
      this.stopAutoScroll();
      this.armedRow = null;
      this.dragFrom = null;
      this.dragOver = null;
      this.dragStory = null;
    },
    // ---- Auto-scroll while a row is in flight ----
    //
    // Native HTML5 drag scrolls nothing for you: a row dragged to the top edge
    // of the dialog just sits against it, so a track could only be moved as far
    // as the list already happened to be scrolled. Dragging item 5 to the top of
    // a ten-item pack was not possible at all without scrolling first, letting
    // go, and dragging again.
    //
    // The scrolling runs off requestAnimationFrame rather than off dragover
    // because the pointer is usually *still* at that moment: someone holding a
    // row against the top edge is asking the list to keep moving, and a
    // dragover-driven scroll would stop the instant they stopped wiggling the
    // mouse. dragover only feeds it the pointer position.
    startAutoScroll() {
      const el = this.$refs.scroller;
      if (!el || this.autoScrollRaf) return;

      this.autoScrollY = null;
      this.trackAutoScroll = (event) => { this.autoScrollY = event.clientY; };
      // On the container, not the rows: the pointer spends part of a drag over
      // the gaps between rows, and the edges themselves are padding.
      el.addEventListener('dragover', this.trackAutoScroll);

      const step = () => {
        this.autoScrollRaf = requestAnimationFrame(step);
        if (this.autoScrollY === null) return;

        const box = el.getBoundingClientRect();
        const fromTop = this.autoScrollY - box.top;
        const fromBottom = box.bottom - this.autoScrollY;

        // Speed ramps with depth into the zone, so easing towards the edge
        // creeps and pinning against it travels — the list is being read on the
        // way past, not just moved.
        if (fromTop < AUTO_SCROLL_EDGE) {
          el.scrollTop -= AUTO_SCROLL_MAX_STEP * (1 - Math.max(fromTop, 0) / AUTO_SCROLL_EDGE);
        } else if (fromBottom < AUTO_SCROLL_EDGE) {
          el.scrollTop += AUTO_SCROLL_MAX_STEP * (1 - Math.max(fromBottom, 0) / AUTO_SCROLL_EDGE);
        }
      };
      this.autoScrollRaf = requestAnimationFrame(step);
    },
    stopAutoScroll() {
      if (this.autoScrollRaf) cancelAnimationFrame(this.autoScrollRaf);
      this.autoScrollRaf = null;
      if (this.trackAutoScroll && this.$refs.scroller) {
        this.$refs.scroller.removeEventListener('dragover', this.trackAutoScroll);
      }
      this.trackAutoScroll = null;
      this.autoScrollY = null;
    },
    // Which side of the hovered row to draw the landing line on: above it when
    // the row is travelling up the list, below it when travelling down.
    rowDragClass(index, storyIndex = null) {
      if (this.dragFrom === null || storyIndex !== this.dragStory) return null;
      if (index === this.dragFrom) return 'is-dragging-row';
      if (index !== this.dragOver) return null;
      return this.dragFrom > index ? 'drop-above' : 'drop-below';
    },
    // The row object, not just its position: rows can be moved while the file
    // picker is open, and an index captured here would then name a different row.
    targetItemAt(itemIndex, storyIndex) {
      return storyIndex === null
        ? this.form.items[itemIndex]
        : (this.stories[storyIndex] || {}).items?.[itemIndex];
    },
    pickAudioFile(itemIndex, storyIndex = null) {
      this.pendingUpload = {
        mode: storyIndex === null ? 'flat' : 'story',
        storyIndex,
        itemIndex,
        item: this.targetItemAt(itemIndex, storyIndex),
        field: 'audioUrl'
      };
      if (this.$refs.audioFilePicker) {
        this.$refs.audioFilePicker.click();
      }
    },
    pickImageFile(itemIndex, storyIndex = null) {
      this.pendingUpload = {
        mode: storyIndex === null ? 'flat' : 'story',
        storyIndex,
        itemIndex,
        item: this.targetItemAt(itemIndex, storyIndex),
        field: 'imageUrl'
      };
      if (this.$refs.imageFilePicker) {
        this.$refs.imageFilePicker.click();
      }
    },
    pickPackThumbnailFile() {
      this.pendingUpload = {
        mode: 'packThumbnail',
        field: 'thumbnailUrl'
      };
      if (this.$refs.imageFilePicker) {
        this.$refs.imageFilePicker.click();
      }
    },
    getAuthToken() {
      const storedToken = localStorage.getItem('token');
      if (!storedToken) return null;
      try {
        const parsed = JSON.parse(storedToken);
        return parsed.token || storedToken;
      } catch (e) {
        return storedToken;
      }
    },
    getPendingTargetItem() {
      if (!this.pendingUpload) return null;
      const { mode, item } = this.pendingUpload;
      if (mode === 'packThumbnail') {
        return this.form;
      }
      // The row captured when the picker opened, so a reorder in the meantime
      // cannot land the upload on a different row.
      return item || null;
    },
    async handleAudioFileSelected(event) {
      const file = event?.target?.files?.[0];
      if (!file) return;
      await this.uploadFileToS3(file, 'audio');
      event.target.value = '';
    },
    async handleImageFileSelected(event) {
      const file = event?.target?.files?.[0];
      if (!file) return;
      await this.uploadFileToS3(file, 'image');
      event.target.value = '';
    },
    // `purpose` is 'thumbnail' for the pack's cover art and absent for item
    // artwork. The API converts item pictures to the LVGL .bin the toy draws,
    // and the cover is shown in an <img> here, so it has to say which it is —
    // contentPackId cannot stand in for it, being null until the pack is saved.
    async uploadOne(file, category, { contentPackId, purpose } = {}) {
      const token = this.getAuthToken();
      if (!token) {
        throw new Error('Authentication token missing. Please login again.');
      }

      const formData = new FormData();
      formData.append('file', file);
      formData.append('contentType', 'rfidcontent');
      formData.append('category', category);
      if (this.form.packCode) {
        formData.append('packCode', this.form.packCode);
      }
      if (contentPackId) {
        formData.append('contentPackId', contentPackId);
      }
      if (purpose) {
        formData.append('purpose', purpose);
      }

      const response = await fetch(`${Api.getServiceUrl()}/admin/rfid/content-pack/upload`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`
        },
        body: formData
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || `Upload failed with status ${response.status}`);
      }

      const result = await response.json();
      if (result.code !== 0 || !result.data?.url) {
        throw new Error(result.msg || 'Upload failed');
      }
      return result.data.url;
    },
    // Item files upload to S3 as soon as they're picked, before the dialog's
    // Save button is pressed. For a brand-new pack that means no row exists
    // yet to hang an encryption key on, so create it early.
    //
    // POST /admin/rfid/content-pack never returns the created row (its `data`
    // is always null — see rfid.routes.js), so success is read from the
    // envelope's `code`, not from a returned id. The id then comes from a
    // second call, GET /admin/rfid/content-pack/code/:packCode.
    //
    // A single cached promise is returned to every caller while it's in
    // flight, so two files picked in quick succession can't race two creates
    // for the same pack.
    ensurePackId() {
      if (this.form.id) return Promise.resolve(this.form.id);
      if (this._ensurePackIdPromise) return this._ensurePackIdPromise;

      this._ensurePackIdPromise = this.createPackAndFetchId()
        .then((id) => {
          this.form.id = id;
          return id;
        })
        .finally(() => {
          this._ensurePackIdPromise = null;
        });

      return this._ensurePackIdPromise;
    },
    async createPackAndFetchId() {
      const packCode = String(this.form.packCode || '').trim();
      const name = String(this.form.name || '').trim();
      if (!packCode || !name) {
        // Checked here, before the request, because the server 400s this
        // exact case and that failure never reaches our callback (see
        // callWithTimeout below) — better to never send it.
        throw new Error('Enter a Pack Code and Name before uploading files.');
      }

      await this.callWithTimeout(
        (resolve, reject) => Api.rfid.addContentPack({
          packCode,
          name,
          description: this.form.description,
          contentType: this.normalizeContentType(this.form.contentType),
          language: this.form.language,
          status: this.form.status,
          version: this.form.version,
          active: this.form.active
        }, ({ data }) => {
          if (data && data.code === 0) {
            resolve();
          } else {
            reject(new Error((data && data.msg) || 'Failed to create the pack.'));
          }
        }, (info) => {
          reject(new Error(this.extractApiErrorMessage(info) || 'Failed to create the pack.'));
        }),
        'Creating the pack timed out. Check your connection and try again.'
      );

      return this.callWithTimeout(
        (resolve, reject) => Api.rfid.getContentPackByCode(packCode, ({ data }) => {
          if (data && data.code === 0 && data.data && data.data.id) {
            resolve(data.data.id);
          } else {
            reject(new Error('The pack was created, but its id could not be loaded. Reopen this pack and try again.'));
          }
        }, (info) => {
          reject(new Error(this.extractApiErrorMessage(info) || 'The pack was created, but looking it up failed. Reopen this pack and try again.'));
        }),
        'The pack was created, but looking it up timed out. Reopen this pack and try again.'
      );
    },
    // httpHandlerError (httpRequest.js) calls a wired `.fail()` callback on a
    // 4xx, or on a 200 whose envelope carries a non-zero `code` — passing it
    // the raw success `res` in the latter case (msg at `info.data.msg`) and
    // the raw axios error in the former (msg at `info.response.data.msg`).
    // Read both shapes so the server's own message surfaces either way.
    extractApiErrorMessage(info) {
      return info?.data?.msg || info?.response?.data?.msg;
    },
    // A dropped/timed-out request, or a 5xx, still never reaches either
    // callback: httpRequest.js only wires the fail path above for 4xx/bad-code
    // responses, and for anything else (including a real network drop) it
    // falls through to `.networkFail()`, which for a non-GET just shows a
    // warning toast and gives up (no retry, no callback) — see reAjaxFun in
    // httpRequest.js. So a genuinely dropped request would hang forever
    // without this backstop. `run` gets `(resolve, reject)` and must call one
    // of them on success/failure; this wrapper guarantees the other side
    // settles too. Kept comfortably above axios's own 30s `http.defaults.timeout`
    // (httpRequest.js) so a legitimately slow-but-succeeding request isn't cut
    // off first — shortened from the original 35s now that ordinary server
    // errors are caught immediately via `.fail()` above and this only has to
    // cover a genuinely dropped request or an unwired 5xx.
    callWithTimeout(run, timeoutMessage, ms = 32000) {
      return new Promise((resolve, reject) => {
        let settled = false;
        const timer = setTimeout(() => {
          if (settled) return;
          settled = true;
          reject(new Error(timeoutMessage));
        }, ms);
        run(
          (value) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolve(value);
          },
          (err) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            reject(err);
          }
        );
      });
    },
    async uploadFileToS3(file, type) {
      if (!this.pendingUpload) {
        this.$message.error('No target item selected for upload.');
        return;
      }

      const targetItem = this.getPendingTargetItem();
      if (!targetItem) {
        this.$message.error('Target item not found. Please try again.');
        return;
      }

      const isPackThumbnail = this.pendingUpload.mode === 'packThumbnail';

      this.uploadingMedia = true;
      try {
        if (!isPackThumbnail && !this.form.id) {
          await this.ensurePackId();
        }
        targetItem[this.pendingUpload.field] = await this.uploadOne(
          file,
          this.isSoundQuiz && !isPackThumbnail ? `apps/${this.form.packCode}` : (type === 'audio' ? 'audio' : 'images'),
          {
            contentPackId: isPackThumbnail ? this.form.id : null,
            purpose: isPackThumbnail ? 'thumbnail' : (this.isSoundQuiz ? 'game_asset' : undefined)
          }
        );
        this.$message.success(`${type === 'audio' ? 'Audio' : 'Image'} uploaded successfully.`);
      } catch (error) {
        this.$message.error(`Upload failed: ${error.message}`);
      } finally {
        this.uploadingMedia = false;
      }
    },
    // ---- Folder import (flat mode, or into the selected story when grouped) ----
    // Set on every pick, so a cancelled picker cannot leave 'replace' behind.
    // `@click="pickFolder"` passes the click event, which reads as 'import'.
    pickFolder(action) {
      if (this.isSoundQuiz) return;
      this.folderAction = action === 'replace' ? 'replace' : 'import';
      if (this.$refs.folderPicker) {
        this.$refs.folderPicker.click();
      }
    },
    async handleFolderSelected(event) {
      const replacing = this.folderAction === 'replace';
      const files = Array.from(event?.target?.files || []);
      event.target.value = '';
      if (!files.length) return;

      const fileByPath = new Map(files.map(f => [f.webkitRelativePath || f.name, f]));
      const pairs = pairMediaFiles([...fileByPath.keys()]);
      if (pairs.length === 0) {
        this.$message.warning('No audio files found in that folder.');
        return;
      }

      // Captured now, so changing the selection mid-upload cannot redirect it.
      const targetStory = this.storyMode ? this.stories[this.selectedStory] : null;
      if (this.storyMode && !targetStory) {
        this.$message.warning('Select a story first, then import the folder into it.');
        return;
      }
      const target = targetStory ? targetStory.items : this.form.items;

      // The flat list, and in grouped mode each story, holds at most
      // MAX_TRACKS. A folder that does not fit is refused whole, before
      // anything uploads, rather than cut short. A replace clears the list first.
      const room = roomFor(target.length, { replacing });
      if (pairs.length > room) {
        const holder = targetStory ? 'a story' : 'a content pack';
        const listName = targetStory ? `Story ${this.stories.indexOf(targetStory) + 1}` : 'This pack';
        this.$alert(
          room > 0
            ? `This folder has ${pairs.length} tracks, but ${holder} holds at most ${MAX_TRACKS} tracks and ${replacing ? `the replace leaves room for ${room}` : `only ${room} more can fit`}. Nothing was uploaded. Choose a folder with ${room} track(s) or fewer.`
            : `${listName} already has ${target.length} tracks, and ${holder} holds at most ${MAX_TRACKS}. Nothing was uploaded.`,
          'Track limit exceeded',
          { type: 'error', confirmButtonText: 'OK' }
        ).catch(() => {});
        return;
      }

      // The rows the parent agreed to replace. Only these are removed, so a
      // track added by hand while the upload runs survives it.
      const replaced = replacing ? target.slice() : [];
      if (replacing && !(await this.confirmReplace(replaced.length, pairs.length, targetStory))) return;
      if (!(await this.confirmPairs(pairs, fileByPath))) return;

      if (!this.form.id) {
        try {
          await this.ensurePackId();
        } catch (error) {
          this.$message.error(`Import failed: ${error.message}`);
          return;
        }
      }

      // One item per pair; each file uploads into its own field.
      const newItems = pairs.map(p => ({ _rowKey: nextRowKey(), sequence: 0, title: p.title, audioUrl: '', imageUrl: '', text: '' }));
      const jobs = [];
      pairs.forEach((p, i) => {
        jobs.push({ path: p.audio, category: 'audio', item: newItems[i], field: 'audioUrl' });
        if (p.image) {
          jobs.push({ path: p.image, category: 'images', item: newItems[i], field: 'imageUrl' });
        }
      });

      const failures = [];
      this.importing = true;
      this.importDone = 0;
      this.importTotal = jobs.length;
      try {
        // ponytail: 4 at a time. Raise it if packs ever get much bigger than 10.
        await this.runPool(jobs, 4, async (job) => {
          try {
            job.item[job.field] = await this.uploadOne(fileByPath.get(job.path), job.category);
          } catch (error) {
            failures.push(`${fileName(job.path)}: ${error.message}`);
          } finally {
            this.importDone += 1;
          }
        });
      } finally {
        this.importing = false;
      }

      // An item without audio is unusable, so drop it rather than adding a blank row.
      const imported = newItems.filter(item => item.audioUrl);
      if (targetStory && !this.stories.includes(targetStory)) {
        this.$message.warning('That story was deleted during the upload, so its imported tracks were not added.');
        return;
      }
      // Old rows go only once something new uploaded, so a replace whose
      // uploads all failed leaves the list as it was.
      if (replacing && imported.length) {
        const kept = target.filter(item => !replaced.includes(item));
        target.splice(0, target.length, ...kept);
      }
      imported.forEach(item => target.push(item));
      this.resequence(target);

      const where = targetStory ? ` in Story ${this.stories.indexOf(targetStory) + 1}` : '';
      if (imported.length) {
        if (replacing) {
          this.$message.success(`Replaced with ${imported.length} track(s)${where}.`);
        } else {
          this.$message.success(targetStory
            ? `Imported ${imported.length} track(s) into Story ${this.stories.indexOf(targetStory) + 1}.`
            : `Imported ${imported.length} item(s).`);
        }
      } else if (replacing) {
        this.$message.warning(`Nothing uploaded, so the current tracks${where} were kept.`);
      }
      if (failures.length) {
        this.$message.warning(`${failures.length} file(s) failed to upload: ${failures.join('; ')}`);
      }
    },
    // Renders a locally picked image file to a data URL, decoding .bin through
    // the LVGL parser. Nothing here touches the network.
    async localImagePreview(file) {
      if (!file) return null;
      try {
        if (isBinUrl(file.name)) {
          return lvglBinToDataUrl(await file.arrayBuffer());
        }
        return URL.createObjectURL(file);
      } catch (error) {
        console.warn('Local preview failed for', file.name, error);
        return null;
      }
    },
    // ---- Folder download (flat: the whole pack, grouped: the selected story) ----
    // One .zip holding one folder. Files are named "01-Title.mp3" and
    // "01-Title.bin", so the unzipped folder goes straight back through Import
    // Folder or Replace, paired and in the same order. Fetched through the
    // content proxy because the CDN does not answer the browser directly.
    async downloadFolder() {
      const story = this.storyMode ? this.stories[this.selectedStory] : null;
      if (this.storyMode && !story) {
        this.$message.warning('Select a story first, then download it.');
        return;
      }
      const items = story ? story.items : this.form.items;
      const packName = this.form.name || this.form.packCode || 'content-pack';
      const folder = this.safeFileName(story
        ? `${packName} - Story ${this.stories.indexOf(story) + 1}${story.title ? ` - ${story.title}` : ''}`
        : packName) || 'content-pack';

      const pad = Math.max(2, String(items.length).length);
      const jobs = [];
      items.forEach((item, i) => {
        const base = `${String(i + 1).padStart(pad, '0')}-${this.safeFileName(item.title) || 'track'}`;
        // A URL without an extension still needs one, or the audio and image
        // of a track would collide on the same name.
        if (item.audioUrl) jobs.push({ url: item.audioUrl, name: base + (this.urlExtension(item.audioUrl) || '.mp3') });
        if (item.imageUrl) jobs.push({ url: item.imageUrl, name: base + (this.urlExtension(item.imageUrl) || '.png') });
      });
      if (!jobs.length) {
        this.$message.warning('These tracks have no files to download.');
        return;
      }

      const token = this.getAuthToken();
      const files = {};
      const failures = [];
      this.downloading = true;
      try {
        await this.runPool(jobs, 4, async (job) => {
          try {
            const response = await fetch(`${Api.getServiceUrl()}/content/proxy?url=${encodeURIComponent(job.url)}`, {
              headers: token ? { Authorization: `Bearer ${token}` } : {}
            });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            files[`${folder}/${job.name}`] = new Uint8Array(await response.arrayBuffer());
          } catch (error) {
            failures.push(`${job.name}: ${error.message}`);
          }
        });

        const saved = Object.keys(files).length;
        if (!saved) {
          this.$message.error(`Download failed: ${failures.join('; ')}`);
          return;
        }

        // Loaded on first use so the zip code stays out of the main bundle.
        // Level 0 stores: audio and images are compressed already.
        const { zipSync } = await import('fflate');
        const blobUrl = URL.createObjectURL(new Blob([zipSync(files, { level: 0 })], { type: 'application/zip' }));
        const link = document.createElement('a');
        link.href = blobUrl;
        link.download = `${folder}.zip`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);

        if (failures.length) {
          this.$message.warning(`Downloaded ${saved} file(s); ${failures.length} failed: ${failures.join('; ')}`);
        } else {
          this.$message.success(`Downloaded ${saved} file(s).`);
        }
      } finally {
        this.downloading = false;
      }
    },
    // ".mp3" from a CDN URL (query string and encoding ignored), or '' if none.
    urlExtension(url) {
      try {
        const match = /\.([a-z0-9]{1,5})$/i.exec(decodeURIComponent(new URL(url).pathname));
        return match ? `.${match[1].toLowerCase()}` : '';
      } catch (e) {
        return '';
      }
    },
    // Drops characters no file system accepts in a name.
    safeFileName(name) {
      return String(name || '')
        .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 80);
    },
    confirmReplace(currentCount, newCount, story) {
      const where = story ? `Story ${this.stories.indexOf(story) + 1}` : 'this pack';
      return this.$confirm(
        `All ${currentCount} current track(s) in ${where} will be deleted and replaced with ${newCount} track(s) from this folder. This can't be undone once the pack is saved.`,
        'Replace all tracks?',
        { confirmButtonText: 'Replace', cancelButtonText: 'Cancel', type: 'warning' }
      ).then(() => true).catch(() => false);
    },
    async confirmPairs(pairs, fileByPath) {
      const h = this.$createElement;
      const objectUrls = [];

      const rows = await Promise.all(pairs.map(async (p, i) => {
        const previewUrl = await this.localImagePreview(p.image ? fileByPath.get(p.image) : null);
        if (previewUrl && previewUrl.startsWith('blob:')) objectUrls.push(previewUrl);
        return h('div', { class: 'import-preview-row' }, [
          h('span', { class: 'import-preview-seq' }, [`${i + 1}`]),
          previewUrl
            ? h('img', { class: 'import-preview-thumb', attrs: { src: previewUrl } })
            : h('span', { class: 'import-preview-thumb import-preview-thumb--empty' }, [p.image ? '?' : '—']),
          h('span', { class: 'import-preview-text' }, [
            h('strong', [p.title || '(untitled)']),
            h('span', { class: 'import-preview-files' }, [
              `${fileName(p.audio)} + ${p.image ? fileName(p.image) : 'no image'}`
            ])
          ])
        ]);
      }));

      rows.unshift(h('div', { class: 'import-preview-hint' }, [
        'Nothing has been uploaded yet. These previews are read from your local files — check each image matches its audio, then press Upload.'
      ]));

      try {
        return await this.$confirm(h('div', { class: 'import-preview' }, rows), `Import ${pairs.length} item(s)?`, {
          confirmButtonText: 'Upload',
          cancelButtonText: 'Cancel',
          customClass: 'import-preview-box'
        }).then(() => true).catch(() => false);
      } finally {
        objectUrls.forEach(url => URL.revokeObjectURL(url));
      }
    },
    async runPool(jobs, size, worker) {
      const queue = jobs.slice();
      const runners = Array.from(
        { length: Math.min(size, queue.length) },
        async () => { while (queue.length) await worker(queue.shift()); }
      );
      await Promise.all(runners);
    },
    async toggleAudio(url) {
      if (!url) return;

      if (this.playingUrl === url) {
        // Pause current
        if (this.currentAudio) {
            this.currentAudio.pause();
        }
        this.playingUrl = null;
      } else {
        // Stop previous
        this.stopAudio();

        try {
          const objectUrl = await previewAudioObjectUrl(url, this.form.packCode);
          this.currentObjectUrl = objectUrl;
          this.currentAudio = new Audio(objectUrl);
          this.currentAudio.onended = () => { this.playingUrl = null; };
          await this.currentAudio.play();
          this.playingUrl = url;
        } catch (err) {
          console.error('Audio preview failed', err);
          this.$message.error('Could not play audio');
          this.playingUrl = null;
        }
      }
    },
    stopAudio() {
        if (this.currentAudio) {
            this.currentAudio.pause();
            this.currentAudio = null;
        }
        if (this.currentObjectUrl) {
            URL.revokeObjectURL(this.currentObjectUrl);
            this.currentObjectUrl = null;
        }
        this.playingUrl = null;
    },
    // What a preview box shows for a URL, or null while there is nothing to
    // show. A web image goes straight to the <img>. A device `.bin` cannot, so
    // it is fetched and decoded the first time the render asks for it — which
    // is what makes flat items, story tracks, the thumbnail, a fresh upload and
    // a hand-edited URL all preview without anything having to remember to load
    // them.
    previewSrc(url) {
      if (!url || this.failedPreviews[url]) return null;
      if (!isBinUrl(url)) return url;
      if (!(url in this.binPreviews)) this.loadBinPreview(url);
      return this.binPreviews[url] || null;
    },
    previewLoading(url) {
      return isBinUrl(url) && !this.failedPreviews[url] && !this.binPreviews[url];
    },
    markPreviewFailed(url) {
      this.$set(this.failedPreviews, url, true);
    },
    loadBinPreview(url) {
      // Marked in flight first, so the re-renders meanwhile do not queue it again.
      this.$set(this.binPreviews, url, null);
      // packCode is what makes this the DECRYPT-aware route. Without it a sealed
      // item .bin comes back as CKE1 bytes, the LVGL decoder rejects the magic,
      // and the cell silently reads "No preview". Empty on a not-yet-saved pack,
      // which is correct: there is nothing sealed to unseal yet.
      loadLvglBinAsDataUrl(url, this.form.packCode).then(dataUrl => {
        if (dataUrl) this.$set(this.binPreviews, url, dataUrl);
        else this.markPreviewFailed(url);
      });
    },
    submit() {
      this.$refs.form.validate((valid) => {
        if (valid) {
          // Build the final form to submit
          const submitForm = { ...this.form };
          submitForm.contentType = this.normalizeContentType(this.form.contentType);
          // Both are server-derived. Echoing the values read back on open pinned
          // content_hash to whatever it was before the edit — so the toy, which
          // compares the hash first, was never told the pack had changed — and
          // pinned the version to whatever was in the box, which is why every
          // pack sat at 1 no matter how often it was edited. Left out, the API
          // derives both from what it actually writes.
          delete submitForm.contentHash;
          delete submitForm.version;

          if (this.storyMode) {
            // Flatten stories into items with storyNumber/storyTitle
            if (this.stories.length === 0 || this.stories.every(s => s.items.length === 0)) {
              this.$message.warning("Please add at least one track to a story.");
              return;
            }
            const flatItems = [];
            this.stories.forEach((story, sIdx) => {
              const storyNum = sIdx + 1;
              story.items.forEach((item, iIdx) => {
                flatItems.push({
                  ...stripRowKey(item),
                  itemNumber: iIdx + 1,
                  storyNumber: storyNum,
                  storyTitle: story.title || `Story ${storyNum}`
                });
              });
            });
            submitForm.items = flatItems;
          } else {
            // Flat mode — ensure no story fields
            if (this.form.items.length === 0) {
              this.$message.warning("Please add at least one item to the pack.");
              return;
            }
            if (this.isSoundQuiz) {
              const n = this.form.items.length;
              if (n < 2 || n > 16) {
                this.$message.warning('A sound quiz needs between 2 and 16 rounds.');
                return;
              }
              const bad = this.form.items.findIndex(it =>
                !String(it.title || '').trim() || !String(it.text || '').trim() ||
                !it.audioUrl || !it.imageUrl || this.distractorList(it).length !== 2 ||
                this.distractorSlots(it)[0] === this.distractorSlots(it)[1]
              );
              if (bad !== -1) {
                this.$message.warning(`Round ${bad + 1} needs a Sound, a Prompt, a sound file, an icon and two different wrong answers.`);
                return;
              }
            }
            // itemNumber comes from array position, so the order shown here is
            // the order that is saved. `id` rides along untouched, which is how
            // the API keeps each item's stored metadata with the right item.
            submitForm.items = this.form.items.map((item, idx) => ({
              ...stripRowKey(item),
              itemNumber: idx + 1,
              storyNumber: null,
              storyTitle: null
            }));
          }

          this.saving = true;
          this.$emit('submit', {
            form: submitForm,
            done: () => {
              this.saving = false;
            }
          });
          setTimeout(() => {
             if (this.saving) this.saving = false;
          }, 5000);
        }
      });
    },
    cancel() {
      this.stopAudio();
      this.saving = false;
      this.pendingUpload = null;
      this.uploadingMedia = false;
      this.$emit('cancel');
    }
  },
  beforeDestroy() {
    // A drag in flight when the dialog is torn down never reaches dragend.
    this.stopAutoScroll();
  },
  watch: {
    visible(newVal) {
      if (newVal) {
        this.dialogKey = Date.now();
        this.loadContentTypes();

        // Detect story mode from existing items (when editing)
        const hasStoryItems = this.form.items && this.form.items.some(i => i.storyNumber > 0);
        if (hasStoryItems) {
          this.storyMode = true;
          // Group items by storyNumber into stories[]
          const storyMap = {};
          for (const item of this.form.items) {
            const sn = item.storyNumber || 1;
            if (!storyMap[sn]) {
              storyMap[sn] = { title: item.storyTitle || '', items: [] };
            }
            // Spread first: the four fields below are the only ones this editor
            // shows, and rebuilding the track from them alone dropped `id` — and
            // with it the row identity the API re-matches metadata by, so a
            // reordered story used to inherit the duration, size and artwork of
            // whichever track had previously held its position.
            storyMap[sn].items.push({
              ...item,
              title: item.title || '',
              audioUrl: item.audioUrl || '',
              imageUrl: item.imageUrl || '',
              text: item.text || '',
              _rowKey: nextRowKey()
            });
          }
          this.stories = Object.keys(storyMap)
            .sort((a, b) => Number(a) - Number(b))
            .map(k => storyMap[k]);
        } else {
          this.storyMode = false;
          this.stories = [];
        }

        this.ensureRowKeys(this.form.items);
        this.stories.forEach(story => this.ensureRowKeys(story.items));
      } else {
        this.stopAudio();
        this.stories = [];
        this.storyMode = false;
        this.selectedStory = null;
        this.pendingUpload = null;
        this.uploadingMedia = false;
        this.importing = false;
        this.importDone = 0;
        this.importTotal = 0;
        this.endRowDrag();
      }
    },
    // Sound-quiz rounds are flat rows; a pack switched to that type while
    // grouped would otherwise lock the disabled switch in the ON position and
    // hide the editor.
    isSoundQuiz(val) {
      if (val && this.storyMode) {
        this.storyMode = false;
        this.selectedStory = null;
      }
    }
  }
};
</script>

<style>
/* Dialog chrome. Not scoped: el-dialog mounts on body. Shared verbatim by
   every RFID dialog so the overlay reads the same wherever it opens. */
.custom-rfid-dialog {
  border-radius: 10px !important;
  overflow: hidden;
  border: 1px solid var(--border-color) !important;
  box-shadow: var(--shadow-overlay) !important;
}
.custom-rfid-dialog .el-dialog__header {
  display: none;
}
.custom-rfid-dialog .el-dialog__body {
  padding: 0 !important;
}
/* MessageBox is appended to body, so these cannot be scoped. */
.import-preview-box {
  width: 520px;
}
.import-preview {
  max-height: 360px;
  overflow-y: auto;
  font-size: 12.5px;
  color: var(--text-body);
}
.import-preview-hint {
  margin-bottom: 10px;
  padding: 8px 10px;
  border-radius: 6px;
  background: var(--success-bg);
  color: var(--success);
  font-size: 11.5px;
  line-height: 1.55;
}
.import-preview-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 0;
  border-bottom: 1px solid var(--divider-color);
}
.import-preview-row:last-child {
  border-bottom: none;
}
.import-preview-seq {
  flex: 0 0 20px;
  height: 20px;
  border-radius: 4px;
  background: var(--surface-sunk);
  color: var(--text-light);
  font-family: var(--font-mono);
  font-size: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.import-preview-thumb {
  flex: 0 0 48px;
  width: 48px;
  height: 48px;
  border-radius: 6px;
  border: 1px solid var(--border-color);
  background: var(--surface-sunk);
  object-fit: contain;
  image-rendering: pixelated;
}
.import-preview-thumb--empty {
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-light);
  font-size: 16px;
}
.import-preview-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.import-preview-files {
  color: var(--text-light);
  font-family: var(--font-mono);
  font-size: 10.5px;
  word-break: break-all;
}
</style>

<style scoped lang="scss">
@import '@/styles/theme.scss';

// The pack editor. Same warm-monochrome ground, 1px rules and mono
// micro-labels as the page behind it, so opening it is not a change of
// visual language.
.rfid-dialog-wrapper {
  .dialog-container {
    padding: 26px 30px 24px;
    background: $surface;
    max-height: 78vh;
    overflow-y: auto;
  }

  .dialog-header {
    position: relative;
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 16px;
    padding-bottom: 18px;
    margin-bottom: 22px;
    border-bottom: 1px solid $border-color;
  }

  .dialog-title {
    margin: 0;
    font-family: $font-display;
    font-size: 24px;
    font-weight: 400;
    letter-spacing: -0.02em;
    color: $text-dark;
  }

  .custom-close-btn {
    flex: 0 0 auto;
    width: 26px;
    height: 26px;
    border-radius: $radius-sm;
    border: 1px solid $border-color;
    background: $surface;
    color: $text-light;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    outline: none;
    transition: color 0.18s ease, border-color 0.18s ease;

    &:hover {
      color: $text-dark;
      border-color: $text-light;
    }
  }

  .rfid-form {
    .form-item {
      margin-bottom: 16px;

      :deep(.el-form-item__label) {
        color: $text-gray;
        font-weight: 500;
        // 12.5px inherited the global uppercase + 0.1em tracking, which pushed
        // "Group by Stories" to 141px against a 130px label column and wrapped
        // it. At 11px/0.04em the longest label measures 114px and fits.
        font-size: 11px;
        letter-spacing: 0.04em;
        line-height: 34px;
        white-space: nowrap;
      }
    }

    .new-playlist {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-top: 8px;

      :deep(.el-input) { flex: 1; min-width: 0; }
    }

    .thumbnail-field {
      display: flex;
      align-items: center;
      gap: 10px;

      :deep(.el-input) { flex: 1; min-width: 0; }
    }

    .thumbnail-preview-box {
      width: 60px;
      height: 60px;
      border-radius: $radius-md;
      border: 1px solid $border-color;
      background: $surface-sunk;
      flex-shrink: 0;
      overflow: hidden;
      display: flex;
      align-items: center;
      justify-content: center;

      img {
        max-width: 100%;
        max-height: 100%;
        object-fit: contain;
      }

      .thumbnail-preview-error {
        color: $text-light;
        font-size: 20px;
      }
    }

    .custom-input,
    .custom-select {
      :deep(.el-input__inner) {
        height: 34px;
        line-height: 34px;
      }
    }

    .custom-select {
      width: 100%;
    }

    .custom-textarea {
      :deep(.el-textarea__inner) {
        font-family: $font-sans;
      }
    }

    .total-items-input {
      width: 160px;
    }

    // ---- Items -----------------------------------------------------------
    .items-section {
      margin-top: 4px;
      border: 1px solid $border-color;
      border-radius: $radius-md;
      background: $surface;
      overflow: hidden;
    }

    .items-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      padding: 12px 14px;
      border-bottom: 1px solid $divider-color;
      background: $surface-sunk;
    }

    .items-title {
      font-family: $font-mono;
      font-size: 9.5px;
      font-weight: 500;
      text-transform: uppercase;
      letter-spacing: 0.11em;
      color: $text-light;
    }

    .items-header-actions {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .items-list {
      padding: 0 14px;
    }

    .item-row {
      display: flex;
      gap: 12px;
      padding: 14px 0;
      border-bottom: 1px solid $divider-color;
      align-items: flex-start;

      &:last-child {
        border-bottom: none;
      }
    }

    .seq-col {
      width: 22px;
      padding-top: 7px;
    }

    .seq-badge {
      display: block;
      font-family: $font-mono;
      font-size: 10.5px;
      color: $text-light;
      text-align: right;
    }

    // The grip. It is the only thing that arms the drag, which is what keeps
    // the title and URL fields selectable: a row draggable from anywhere would
    // start a drag instead of a text selection on every click-and-sweep.
    .drag-handle {
      display: block;
      margin: 8px 0 0 auto;
      width: 14px;
      cursor: grab;
      line-height: 0;
      color: $border-color;
      transition: color 0.12s ease;

      &:active {
        cursor: grabbing;
      }

      svg {
        display: block;
        margin: 0 auto;
        fill: currentColor;
      }
    }

    .item-row:hover .drag-handle {
      color: $text-light;
    }

    // The row in flight fades in place, so the list keeps its shape while the
    // landing line does the talking.
    .item-row.is-dragging-row {
      opacity: 0.4;
    }

    .item-row.drop-above {
      box-shadow: inset 0 2px 0 $text-dark;
    }

    .item-row.drop-below {
      box-shadow: inset 0 -2px 0 $text-dark;
    }

    // The insertion strips sit in the gaps between rows. Mid-drag they would
    // take the pointer events that tell us which row is being hovered, and the
    // landing line would stall on whichever row was left.
    .items-list.is-dragging,
    .story-items.is-dragging {
      .insert-divider {
        pointer-events: none;
      }
    }

    .main-col {
      flex: 1;
      display: flex;
      flex-direction: row;
      gap: 12px;
      min-width: 0;
    }

    // The item picture, shown whole: it is card artwork, and a crop hides
    // the subject the child is looking at.
    .img-preview-box {
      width: 88px;
      height: 88px;
      border-radius: $radius-md;
      border: 1px solid $border-color;
      background: $surface-sunk;
      flex-shrink: 0;
      overflow: hidden;
      display: flex;
      align-items: center;
      justify-content: center;
      position: relative;

      img {
        max-width: 100%;
        max-height: 100%;
        object-fit: contain;
      }

      .bin-loading {
        position: absolute;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        background: rgba(245, 243, 239, 0.9);
        color: $text-light;
        font-size: 18px;
      }

      .bin-error {
        position: absolute;
        inset: 0;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 4px;
        background: $danger-bg;
        color: $danger;

        i {
          font-size: 20px;
        }

        span {
          font-family: $font-mono;
          font-size: 9px;
          text-transform: uppercase;
          letter-spacing: 0.1em;
        }
      }
    }

    .version-value {
      font-family: $font-mono;
      font-size: 13px;
      color: $text-dark;
    }

    .action-col {
      width: 26px;
      padding-top: 4px;

    }

    // The insertion point between two cards. A hairline until the row is
    // hovered, so ten of them do not read as ten more rows.
    .insert-divider {
      height: 14px;
      display: flex;
      align-items: center;
      justify-content: center;
      opacity: 0;
      transition: opacity 0.12s ease;

      &:hover,
      &:focus-within {
        opacity: 1;
      }
    }

    .insert-here {
      border: 1px dashed $border-color;
      background: $surface-sunk;
      border-radius: $radius-md;
      color: $text-light;
      font-family: $font-mono;
      font-size: 10px;
      line-height: 1;
      padding: 3px 10px;
      cursor: pointer;

      &:hover:not(:disabled) {
        color: $text-dark;
        border-color: $text-light;
      }

      &:disabled {
        cursor: not-allowed;
        opacity: 0.4;
      }
    }

    .mb-1 {
      margin-bottom: 6px;
    }

    .distractor-row { display: flex; gap: 8px; margin-bottom: 4px; }
    .distractor-row .el-select { flex: 1; }

    .text-input {
      :deep(.el-textarea__inner) {
        background-color: $surface-sunk;
        font-size: 12px;
        resize: none;

        &:focus {
          background-color: $surface;
        }
      }
    }

    .empty-items {
      text-align: center;
      padding: 28px 0;
      color: $text-light;
      font-size: 12.5px;
    }

    .story-mode-hint,
    .field-hint {
      display: block;
      margin-top: 4px;
      font-size: 11px;
      line-height: 1.5;
      color: $text-light;
    }

    .story-mode-hint {
      display: inline;
      margin-left: 12px;
    }

    // ---- Stories ---------------------------------------------------------
    .story-block {
      border: 1px solid $border-color;
      border-radius: $radius-md;
      margin: 14px;
      background: $surface;
      overflow: hidden;
      transition: border-color 0.15s ease, box-shadow 0.15s ease;

      // The story a grouped-mode folder import or replace goes into. A clear
      // blue (the "Grouped" switch's colour), thickened by a ring and a soft
      // glow that do not shift the layout.
      &.is-selected {
        border-color: #409EFF;
        box-shadow: 0 0 0 1px #409EFF, 0 0 0 4px rgba(64, 158, 255, 0.18);
      }
    }

    .replace-btn svg,
    .download-btn svg,
    .icon-btn svg {
      display: block;
    }

    .story-action {
      display: inline-flex;
    }

    .story-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 10px 12px;
      background: $surface-sunk;
      border-bottom: 1px solid $divider-color;
      gap: 10px;
    }

    .story-header-left {
      display: flex;
      align-items: center;
      gap: 10px;
      flex: 1;
      min-width: 0;
    }

    .story-header-right {
      display: flex;
      align-items: center;
      gap: 6px;
      flex-shrink: 0;
    }

    .story-badge {
      font-family: $font-mono;
      font-size: 9.5px;
      text-transform: uppercase;
      letter-spacing: 0.11em;
      color: $text-light;
      white-space: nowrap;
    }

    .story-title-input {
      flex: 1;
      min-width: 0;
    }

    .story-items {
      padding: 0 12px;
    }
  }

  .dialog-footer {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    padding-top: 18px;
    margin-top: 22px;
    border-top: 1px solid $border-color;
  }
}
</style>
