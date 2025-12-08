import json
import asyncio
import logging
from typing import Optional
from livekit.agents import (
    AgentFalseInterruptionEvent,
    AgentStateChangedEvent,
    UserInputTranscribedEvent,
    SpeechCreatedEvent,
    NOT_GIVEN,
)

from ..utils.audio_state_manager import audio_state_manager

logger = logging.getLogger("chat_logger")

# Try to import the conversation_item_added event
try:
    from livekit.agents import ConversationItemAddedEvent
    logger.debug("📚 ConversationItemAddedEvent imported successfully")
except ImportError:
    logger.debug(
        "📚 ConversationItemAddedEvent not available in this LiveKit version")
    ConversationItemAddedEvent = None

# Try to import additional events that might contain agent text responses
try:
    from livekit.agents import ResponseGeneratedEvent, LLMResponseEvent
    logger.debug("📚 Additional response events imported successfully")
except ImportError:
    ResponseGeneratedEvent = None
    LLMResponseEvent = None


class ChatEventHandler:
    """Event handler for chat logging and data channel communication"""

    # Store assistant reference for abort handling
    _assistant_instance = None

    # Store chat history service reference
    _chat_history_service = None

    @staticmethod
    def set_assistant(assistant):
        """Set the assistant instance for abort handling"""
        ChatEventHandler._assistant_instance = assistant

    @staticmethod
    def set_chat_history_service(chat_history_service):
        """Set the chat history service instance"""
        ChatEventHandler._chat_history_service = chat_history_service

    @staticmethod
    async def _handle_abort_playback(session, ctx):
        """Handle abort playback signal from MQTT gateway"""
        try:
            if ChatEventHandler._assistant_instance and hasattr(ChatEventHandler._assistant_instance, 'stop_audio'):
                # Call the existing stop_audio function
                result = await ChatEventHandler._assistant_instance.stop_audio(ctx)
                logger.info(f"🛑 Abort signal processed: {result}")
            else:
                logger.warning(
                    "🛑 Could not access assistant's stop_audio method for abort signal")
        except Exception as e:
            logger.error(f"🛑 Error handling abort playback: {e}")

    @staticmethod
    async def _handle_device_info(session, ctx, device_mac):
        """Handle device info message from MQTT gateway"""
        try:
            if not device_mac:
                logger.warning(
                    "⚠️ No device MAC provided in device_info message")
                return

            # Since the agent now starts with the correct device-specific prompt
            # (extracted from room name), we just log this for informational purposes
            logger.info(
                f"📱 Device info received via data channel - MAC: {device_mac}")
            logger.info(
                f"ℹ️ Agent was already initialized with device-specific prompt for this MAC")

        except Exception as e:
            logger.error(f"Error handling device info: {e}")

    @staticmethod
    async def _handle_device_control_response(session, ctx, message):
        """Handle device control response from MQTT gateway"""
        try:
            action = message.get('action') or message.get(
                'command')  # Support both formats
            success = message.get('success', False)
            current_value = message.get('current_value')
            error_message = message.get('error')

            logger.info(
                f"Device control response - Action: {action}, Success: {success}, Value: {current_value}")

            # Update volume cache if we have the assistant instance and it has device control service
            if (ChatEventHandler._assistant_instance and
                hasattr(ChatEventHandler._assistant_instance, 'device_control_service') and
                    ChatEventHandler._assistant_instance.device_control_service):

                device_service = ChatEventHandler._assistant_instance.device_control_service

                if action in ['set_volume', 'get_volume', 'volume_up', 'volume_down'] and current_value is not None:
                    device_service.update_volume_cache(current_value)
                    logger.info(f"Updated volume cache to {current_value}%")

            # If the command failed, we could optionally trigger a response to inform the user
            if not success and error_message:
                logger.warning(
                    f"Device control action failed: {error_message}")
                # Optionally, you could trigger an agent response here:
                # session.generate_reply(instructions=f"Inform the user that the volume control failed: {error_message}")

        except Exception as e:
            logger.error(f"Error handling device control response: {e}")

    @staticmethod
    async def _handle_end_prompt(session, ctx, end_prompt):
        """Handle end prompt signal from MQTT gateway - trigger goodbye message"""
        try:
            logger.info(f"👋 Generating goodbye message using end prompt")

            # Generate the goodbye message using the provided prompt
            session.generate_reply(instructions=end_prompt)

            logger.info(
                "✅ End prompt message generation triggered successfully")

        except Exception as e:
            logger.error(f"Error handling end prompt: {e}")

    @staticmethod
    async def _handle_function_call(session, ctx, function_name, arguments):
        """Handle function call from mobile app via MQTT gateway"""
        try:
            logger.info(f"🎵 [MOBILE] Executing function call: {function_name}")

            if not ChatEventHandler._assistant_instance:
                logger.error(
                    "❌ [MOBILE] No assistant instance available for function call")
                return

            assistant = ChatEventHandler._assistant_instance

            # Route to appropriate function based on name
            if function_name == "play_music":
                song_name = arguments.get('song_name')
                language = arguments.get('language')
                logger.info(
                    f"🎵 [MOBILE] Calling play_music(song_name='{song_name}', language='{language}')")
                await assistant.play_music(ctx, song_name=song_name, language=language)

            elif function_name == "play_story":
                story_name = arguments.get('story_name')
                category = arguments.get('category')
                logger.info(
                    f"📖 [MOBILE] Calling play_story(story_name='{story_name}', category='{category}')")
                await assistant.play_story(ctx, story_name=story_name, category=category)

            else:
                logger.warning(
                    f"⚠️ [MOBILE] Unknown function call: {function_name}")
                return

            logger.info(
                f"✅ [MOBILE] Function call executed successfully: {function_name}")

        except Exception as e:
            logger.error(
                f"❌ [MOBILE] Error executing function call '{function_name}': {e}")
            import traceback
            logger.error(f"❌ [MOBILE] Traceback: {traceback.format_exc()}")

    @staticmethod
    async def _handle_mcp_response(session, ctx, message):
        """Handle MCP response from MQTT gateway and pass to MCP client"""
        try:
            logger.info(f"🔋 [MCP-RECEIVE] ====== MCP RESPONSE RECEIVED ======")
            logger.info(f"🔋 [MCP-RECEIVE] Full message received: {message}")
            logger.info(f"🔋 [MCP-RECEIVE] Message type: {type(message)}")
            logger.info(f"🔋 [MCP-RECEIVE] Message keys: {list(message.keys()) if isinstance(message, dict) else 'N/A'}")

            if not ChatEventHandler._assistant_instance:
                logger.error("❌ [MCP] No assistant instance available")
                return

            assistant = ChatEventHandler._assistant_instance
            logger.info(f"✅ [MCP] Assistant instance found: {type(assistant).__name__}")

            # Check if assistant has MCP executor
            if not hasattr(assistant, 'mcp_executor') or not assistant.mcp_executor:
                logger.error("❌ [MCP] No MCP executor available in assistant")
                return

            logger.info(f"✅ [MCP] MCP executor found: {type(assistant.mcp_executor).__name__}")

            # Get the MCP client from the executor
            mcp_client = assistant.mcp_executor.mcp_client
            logger.info(f"✅ [MCP] MCP client retrieved: {type(mcp_client).__name__}")

            # Extract the response data
            # The message structure from MQTT is: {"type": "mcp", "payload": {...}}
            payload = message.get('payload', {})
            logger.info(f"🔋 [MCP-PAYLOAD] Extracted payload: {payload}")
            logger.info(f"🔋 [MCP-PAYLOAD] Payload type: {type(payload)}")

            # Extract request_id from the message (if available)
            request_id = message.get('request_id')
            session_id = message.get('session_id')
            logger.info(f"🔋 [MCP-IDS] Request ID: {request_id}")
            logger.info(f"🔋 [MCP-IDS] Session ID: {session_id}")

            # Check if payload has the expected structure
            if payload and 'result' in payload:
                logger.info(f"🔋 [MCP-RESULT] Payload contains 'result' key")
                result = payload.get('result', {})
                logger.info(f"🔋 [MCP-RESULT] Result: {result}")

                if 'content' in result:
                    content = result.get('content', [])
                    logger.info(f"🔋 [MCP-CONTENT] Content array: {content}")
                    if content and len(content) > 0:
                        text_data = content[0].get('text', 'N/A')
                        logger.info(f"🔋 [MCP-DATA] Actual battery data: {text_data}")

            # Pass the response to the MCP client's handler
            if request_id:
                logger.info(f"✅ [MCP-FORWARD] Forwarding to mcp_client.handle_response()")
                logger.info(f"✅ [MCP-FORWARD] Request ID: {request_id}")
                logger.info(f"✅ [MCP-FORWARD] Payload being sent: {payload}")
                mcp_client.handle_response(request_id, payload)
                logger.info(f"✅ [MCP-FORWARD] handle_response() call completed")
            else:
                logger.warning("⚠️ [MCP] No request_id in MCP response, attempting fallback matching")
                logger.warning(f"⚠️ [MCP] Trying to call handle_response with no request_id...")
                mcp_client.handle_response(None, payload)
                logger.info(f"✅ [MCP-FALLBACK] Fallback handle_response() call completed")

            logger.info(f"🔋 [MCP-RECEIVE] ====== MCP RESPONSE PROCESSING COMPLETE ======")

        except Exception as e:
            logger.error(f"❌ [MCP] Error handling MCP response: {e}")
            import traceback
            logger.error(f"❌ [MCP] Traceback: {traceback.format_exc()}")

    @staticmethod
    def setup_session_handlers(session, ctx):
        """Setup all event handlers for the agent session"""

        # Add debug logging for all session events
        logger.info("🔧 Setting up session event handlers")

        @session.on("agent_false_interruption")
        def _on_agent_false_interruption(ev: AgentFalseInterruptionEvent):
            logger.info("False positive interruption, resuming")
            session.generate_reply(
                instructions=ev.extra_instructions or NOT_GIVEN)
            payload = json.dumps({
                "type": "agent_false_interruption",
                "data": ev.model_dump()
            })
            asyncio.create_task(ctx.room.local_participant.publish_data(
                payload.encode("utf-8"), reliable=True))
            logger.info("Sent agent_false_interruption via data channel")

        @session.on("agent_state_changed")
        def _on_agent_state_changed(ev: AgentStateChangedEvent):
            # Convert state objects to lowercase strings for gateway compatibility
            old_state_str = str(ev.old_state).lower() if ev.old_state else "unknown"
            new_state_str = str(ev.new_state).lower() if ev.new_state else "unknown"

            logger.info(f"Agent state changed: {old_state_str} → {new_state_str}")

            # Check if this state change should be suppressed due to music playback
            should_suppress = audio_state_manager.should_suppress_agent_state_change(
                ev.old_state, ev.new_state
            )

            if should_suppress:
                logger.info(
                    f"🎵 Suppressing agent state change from {old_state_str} to {new_state_str} - music is playing")
                return

            # Skip listening → thinking for Gemini Realtime (no separate thinking phase)
            if "listening" in old_state_str and "thinking" in new_state_str:
                logger.info(
                    f"🧠 Skipping listening → thinking state change (Gemini Realtime mode)")
                return

            # Send with string values for gateway compatibility
            payload = json.dumps({
                "type": "agent_state_changed",
                "data": {"old_state": old_state_str, "new_state": new_state_str}
            })
            asyncio.create_task(ctx.room.local_participant.publish_data(
                payload.encode("utf-8"), reliable=True))
            logger.info(f"Sent agent_state_changed via data channel: {old_state_str} → {new_state_str}")

        @session.on("user_input_transcribed")
        def _on_user_input_transcribed(ev: UserInputTranscribedEvent):
            # Skip partial transcripts - only log final ones
            if hasattr(ev, 'is_final') and not ev.is_final:
                return
            logger.info(f"👤 User said: {ev}")

            # Try to extract transcript text from different possible attributes
            user_text = None
            try:
                # Check for transcript attribute first (most likely)
                if hasattr(ev, 'transcript') and ev.transcript:
                    user_text = str(ev.transcript).strip()
                    logger.debug(
                        f"👤 Found user text in 'transcript': '{user_text[:50]}...'")
                # Fallback to text attribute
                elif hasattr(ev, 'text') and ev.text:
                    user_text = str(ev.text).strip()
                    logger.debug(
                        f"👤 Found user text in 'text': '{user_text[:50]}...'")
                # Check event dict as fallback
                else:
                    event_dict = ev.dict() if hasattr(ev, 'dict') else {}
                    for key in ['transcript', 'text', 'content', 'message']:
                        if key in event_dict and event_dict[key]:
                            user_text = str(event_dict[key]).strip()
                            logger.debug(
                                f"👤 Found user text in '{key}': '{user_text[:50]}...'")
                            break
            except Exception as e:
                logger.error(f"👤 Error extracting user text: {e}")

            # Capture user message for chat history - DISABLED to avoid duplication
            # This is now handled by the 'conversation_item_added' event
            if False and ChatEventHandler._chat_history_service and user_text:
                try:
                    ChatEventHandler._chat_history_service.add_message(
                        chat_type=1,  # 1 = user
                        content=user_text,
                        timestamp=getattr(ev, 'timestamp', None)
                    )
                    logger.info(
                        f"📝✅ Captured user message for chat history: '{user_text[:100]}...' ({len(user_text)} chars)")

                    # Get current chat history stats
                    stats = ChatEventHandler._chat_history_service.get_stats()
                    logger.debug(
                        f"📊 Chat history stats: {stats['total_messages']} total, {stats['buffered_messages']} buffered")

                except Exception as e:
                    logger.error(
                        f"📝❌ Failed to capture user message for chat history: {e}")
            else:
                if not user_text:
                    logger.warning(
                        f"📝⚠️ Empty transcript detected - triggering clarification response")
                    # Also log the event dict for debugging
                    try:
                        event_dict = ev.dict() if hasattr(ev, 'dict') else {}
                        logger.debug(f"📝⚠️ Event dict: {event_dict}")
                    except Exception as e:
                        logger.debug(f"📝⚠️ Could not get event dict: {e}")

                    # Generate a user-friendly clarification message
                    clarification_messages = [
                        "Sorry, I couldn't hear you properly. Could you please repeat that?",
                        "I didn't catch that. Could you say it again?",
                        "Sorry, I couldn't understand. Can you repeat what you said?",
                        "I couldn't hear you clearly. Could you please try again?"
                    ]
                    import random
                    clarification = random.choice(clarification_messages)
                    logger.info(f"🔊 Asking for clarification: '{clarification}'")
                    session.generate_reply(instructions=f"Say this exact message to the user: '{clarification}'. Do not add anything else, just say this message naturally.")

            payload = json.dumps({
                "type": "user_input_transcribed",
                "data": ev.dict()
            })
            asyncio.create_task(ctx.room.local_participant.publish_data(
                payload.encode("utf-8"), reliable=True))
            logger.info("📡 Sent user_input_transcribed via data channel")

        # Add conversation_item_added event handler (the proper way)
        try:
            @session.on("conversation_item_added")
            def _on_conversation_item_added(ev):
                # logger.info(f"💬 Conversation item added: {ev}")
                try:
                    # Extract the conversation item
                    if hasattr(ev, 'item') and ev.item:
                        item = ev.item
                        # logger.debug(f"💬 Item type: {type(item)}")
                        # logger.debug(
                        #     f"💬 Item attributes: {[attr for attr in dir(item) if not attr.startswith('_')]}")

                        # Get role and content
                        role = getattr(item, 'role', 'unknown')
                        content = None
                        
                        # ============================================
                        # GOOGLE SEARCH GROUNDING DETECTION
                        # ============================================
                        # Check for grounding metadata to verify if Google Search is being used
                        grounding_attrs = ['grounding_metadata', 'groundingMetadata', 'grounding_chunks', 
                                          'grounding_supports', 'search_queries', 'web_search_queries',
                                          'search_entry_point', 'citations', 'sources']
                        
                        for attr in grounding_attrs:
                            if hasattr(item, attr):
                                grounding_value = getattr(item, attr)
                                if grounding_value:
                                    logger.info(f"🔍✅ GROUNDING DETECTED! Found '{attr}': {grounding_value}")
                        
                        # Also check all attributes for any grounding-related data
                        all_attrs = [a for a in dir(item) if not a.startswith('_')]
                        for attr in all_attrs:
                            try:
                                if 'ground' in attr.lower() or 'search' in attr.lower() or 'citation' in attr.lower():
                                    value = getattr(item, attr)
                                    if value and not callable(value):
                                        logger.info(f"🔍 GROUNDING-RELATED ATTR: {attr} = {value}")
                            except:
                                pass
                        
                        # Check if item has 'metadata' or similar nested structures
                        if hasattr(item, 'metadata'):
                            metadata = getattr(item, 'metadata')
                            if metadata:
                                logger.info(f"🔍 Item metadata: {metadata}")
                        
                        # ============================================
                        # END GROUNDING DETECTION
                        # ============================================

                        # Try to get content from various attributes
                        for attr in ['content', 'text', 'message', 'transcript']:
                            if hasattr(item, attr) and getattr(item, attr):
                                content = str(getattr(item, attr)).strip()
                                logger.debug(
                                    f"💬 Found content in '{attr}': '{content[:50]}...'")
                                break

                        if content and ChatEventHandler._chat_history_service:
                            # Determine chat type based on role
                            chat_type = 1 if role == 'user' else 2  # 1=user, 2=agent

                            try:
                                ChatEventHandler._chat_history_service.add_message(
                                    chat_type=chat_type,
                                    content=content,
                                    timestamp=getattr(item, 'timestamp', None)
                                )

                                role_emoji = "👤" if role == "user" else "🤖"
                                logger.info(
                                    f"📝✅ Captured {role_emoji} {role} message from conversation_item_added: '{content[:100]}...' ({len(content)} chars)")

                                # Get current chat history stats
                                stats = ChatEventHandler._chat_history_service.get_stats()
                                logger.debug(
                                    f"📊 Chat history stats: {stats['total_messages']} total, {stats['buffered_messages']} buffered")

                            except Exception as e:
                                logger.error(
                                    f"📝❌ Failed to capture conversation item: {e}")
                        else:
                            if not content:
                                logger.debug(
                                    f"💬 No content found in conversation item with role: {role}")
                            if not ChatEventHandler._chat_history_service:
                                logger.debug(
                                    f"💬 No chat history service available")

                except Exception as e:
                    logger.error(
                        f"💬 Error processing conversation_item_added: {e}")
                    import traceback
                    logger.debug(f"💬 Traceback: {traceback.format_exc()}")
        except Exception as e:
            logger.debug(
                "💬 conversation_item_added event handler setup failed (event may not exist in this version)")

        @session.on("speech_created")
        def _on_speech_created(ev: SpeechCreatedEvent):
            try:
                logger.info(f"🤖 Speech created event received")
                logger.debug(f"🤖 Event type: {type(ev).__name__}")

                # Safely get available attributes
                try:
                    # Filter out model internal fields to avoid deprecation warnings
                    available_attrs = [
                        attr for attr in dir(ev)
                        if not attr.startswith('_')
                        and attr not in ['model_fields', 'model_computed_fields', 'model_config', 'model_extra', 'model_fields_set']
                        and not callable(getattr(ev, attr, None))
                    ]
                    logger.debug(f"🤖 Available attributes: {available_attrs}")
                except Exception as attr_error:
                    logger.debug(
                        f"🤖 Could not inspect event attributes: {attr_error}")

                # Try to get the event dict safely using Pydantic V2 method
                try:
                    # Use model_dump() for Pydantic V2, fallback to dict() for V1
                    event_dict = ev.model_dump() if hasattr(ev, 'model_dump') else ev.dict()
                    logger.debug(f"🤖 Event dict: {event_dict}")

                    # Look for text content in the dict
                    text_content = None
                    for key in ['text', 'content', 'message', 'transcript', 'response']:
                        if key in event_dict and event_dict[key]:
                            text_content = str(event_dict[key]).strip()
                            if text_content:
                                logger.debug(
                                    f"🤖 Found text content in '{key}': '{text_content[:50]}...'")
                                break

                    # If no text found in dict, try direct attributes
                    if not text_content:
                        for attr in ['text', 'content', 'message', 'transcript', 'response']:
                            try:
                                if hasattr(ev, attr):
                                    text_value = getattr(ev, attr)
                                    if text_value and isinstance(text_value, str) and text_value.strip():
                                        text_content = text_value.strip()
                                        logger.debug(
                                            f"🤖 Found text content in '{attr}' attribute: '{text_content[:50]}...'")
                                        break
                            except Exception as e:
                                logger.debug(
                                    f"🤖 Error accessing attribute '{attr}': {e}")

                    # Capture agent response for chat history
                    if ChatEventHandler._chat_history_service and text_content:
                        try:
                            ChatEventHandler._chat_history_service.add_message(
                                chat_type=2,  # 2 = agent
                                content=text_content,
                                timestamp=getattr(ev, 'timestamp', None)
                            )
                            logger.info(
                                f"📝✅ Captured agent response for chat history: '{text_content[:100]}...' ({len(text_content)} chars)")

                            # Get current chat history stats
                            stats = ChatEventHandler._chat_history_service.get_stats()
                            logger.debug(
                                f"📊 Chat history stats: {stats['total_messages']} total, {stats['buffered_messages']} buffered")

                        except Exception as e:
                            logger.error(
                                f"📝❌ Failed to capture agent response for chat history: {e}")
                    else:
                        if not ChatEventHandler._chat_history_service:
                            logger.debug(
                                f"📝⚠️ No chat history service available for agent response")
                        elif not text_content:
                            logger.debug(
                                f"📝⚠️ No text content found in speech event")

                    # Send data channel message
                    payload = json.dumps({
                        "type": "speech_created",
                        "data": event_dict
                    })
                    asyncio.create_task(ctx.room.local_participant.publish_data(
                        payload.encode("utf-8"), reliable=True))
                    logger.info("📡 Sent speech_created via data channel")

                except Exception as dict_error:
                    logger.error(
                        f"🤖 Error processing speech_created event dict: {dict_error}")
                    # Fallback: send minimal payload
                    payload = json.dumps({
                        "type": "speech_created",
                        "data": {"event_type": str(type(ev).__name__)}
                    })
                    asyncio.create_task(ctx.room.local_participant.publish_data(
                        payload.encode("utf-8"), reliable=True))
                    logger.info(
                        "📡 Sent fallback speech_created via data channel")

            except Exception as e:
                logger.error(
                    f"🤖❌ Critical error in speech_created handler: {e}")
                import traceback
                logger.error(f"🤖❌ Traceback: {traceback.format_exc()}")

        # Note: Complex event hooks removed - using conversation_item_added instead
        logger.debug(
            "💬 Relying on conversation_item_added event for agent response capture")

        # Alternative approach: Periodically check session.history for new messages
        last_message_count = 0

        async def check_session_history():
            nonlocal last_message_count
            try:
                if hasattr(session, 'history'):
                    # logger.debug(f"📚 Session has history attribute: {type(session.history)}")

                    if session.history and hasattr(session.history, 'messages'):
                        current_messages = session.history.messages
                        current_count = len(current_messages)
                        logger.debug(
                            f"📚 Session history: {current_count} messages")

                        if current_count > last_message_count:
                            # logger.info(f"📚 NEW MESSAGES: Session history has {current_count} messages (was {last_message_count})")

                            # Check new messages
                            new_messages = current_messages[last_message_count:]
                            for i, msg in enumerate(new_messages):
                                try:
                                    # logger.debug(f"📚 Message {i}: type={type(msg)}, attrs={[attr for attr in dir(msg) if not attr.startswith('_')]}")

                                    # Try to get message info
                                    role = getattr(msg, 'role', 'unknown')
                                    logger.debug(f"📚 Message {i} role: {role}")

                                    # Check if this is an agent/assistant message
                                    if role in ['assistant', 'agent']:
                                        text_content = None

                                        # Try multiple attributes for content
                                        for attr in ['content', 'text', 'message', 'data']:
                                            if hasattr(msg, attr):
                                                attr_value = getattr(msg, attr)
                                                if attr_value:
                                                    text_content = str(
                                                        attr_value).strip()
                                                    logger.debug(
                                                        f"📚 Found content in '{attr}': '{text_content[:50]}...'")
                                                    break

                                        if text_content and ChatEventHandler._chat_history_service:
                                            ChatEventHandler._chat_history_service.add_message(
                                                chat_type=2,  # 2 = agent
                                                content=text_content,
                                                timestamp=getattr(
                                                    msg, 'timestamp', None)
                                            )
                                            logger.info(
                                                f"📝✅ Captured agent response from session history: '{text_content[:100]}...' ({len(text_content)} chars)")
                                        else:
                                            logger.debug(
                                                f"📚 No usable content found for role '{role}'")
                                    else:
                                        logger.debug(
                                            f"📚 Skipping message with role: {role}")

                                except Exception as e:
                                    logger.debug(
                                        f"📚 Error processing history message {i}: {e}")

                            last_message_count = current_count
                #     else:
                #         logger.debug(f"📚 Session history has no messages attribute or is None")
                # else:
                #     logger.debug(f"📚 Session has no history attribute")

            except Exception as e:
                logger.error(f"📚 Error checking session history: {e}")
                import traceback
                logger.debug(f"📚 Traceback: {traceback.format_exc()}")

        # Start periodic history checking task
        history_check_task = None
        try:
            async def periodic_history_check():
                while True:
                    await asyncio.sleep(2)  # Check every 2 seconds
                    await check_session_history()

            history_check_task = asyncio.create_task(periodic_history_check())
            logger.debug("📚 Started session history monitoring task")
        except Exception as e:
            logger.debug(f"📚 Could not start history monitoring: {e}")

        # Add data channel message handler for abort signals
        @ctx.room.on("data_received")
        def _on_data_received(data_packet):
            try:
                # Decode the data
                message_str = data_packet.data.decode('utf-8')
                message = json.loads(message_str)

                logger.info(
                    f"📨 Received data channel message: {message.get('type', 'unknown')}")

                # Handle abort playback message from MQTT gateway
                if message.get('type') == 'abort_playback':
                    logger.info(
                        "🛑 Processing abort playback signal from MQTT gateway")
                    # Create task for immediate execution (stop() method is now aggressive)
                    asyncio.create_task(
                        ChatEventHandler._handle_abort_playback(session, ctx))

                # Handle device info message from MQTT gateway
                elif message.get('type') == 'device_info':
                    device_mac = message.get('device_mac')
                    logger.info(
                        f"📱 Processing device info from MQTT gateway - MAC: {device_mac}")
                    # Create task to update agent prompt
                    asyncio.create_task(
                        ChatEventHandler._handle_device_info(session, ctx, device_mac))

                # Handle agent ready message from MQTT gateway
                elif message.get('type') == 'agent_ready':
                    logger.info(
                        "🤖 Processing agent ready signal from MQTT gateway")
                    # Trigger initial greeting from the agent
                    greeting_instructions = "Say a brief, friendly hello to greet the user and let them know you're ready to chat. Keep it short and welcoming."
                    session.generate_reply(instructions=greeting_instructions)

                # Handle cleanup request from MQTT gateway
                elif message.get('type') == 'cleanup_request':
                    logger.info(
                        "🧹 Processing cleanup request from MQTT gateway")
                    # This will trigger our participant disconnect logic
                    # The room cleanup will be handled by the event handlers in main.py

                # Handle device control response from MQTT gateway
                elif message.get('type') == 'device_control_response':
                    logger.info(
                        "🎛️ Processing device control response from MQTT gateway")
                    asyncio.create_task(
                        ChatEventHandler._handle_device_control_response(session, ctx, message))

                # Handle end prompt message from MQTT gateway
                elif message.get('type') == 'end_prompt':
                    logger.info(
                        "👋 Processing end prompt signal from MQTT gateway")
                    end_prompt = message.get(
                        'prompt', 'You must end this conversation now. Start with "Time flies so fast" and say a SHORT goodbye in 1-2 sentences maximum. Do NOT ask questions or suggest activities. Just say goodbye emotionally and end the conversation.')
                    asyncio.create_task(
                        ChatEventHandler._handle_end_prompt(session, ctx, end_prompt))

                # Handle function call from MQTT gateway (mobile app requests)
                elif message.get('type') == 'function_call':
                    logger.info(
                        "🎵 Processing function call from MQTT gateway (mobile app)")
                    function_call = message.get('function_call', {})
                    function_name = function_call.get('name')
                    arguments = function_call.get('arguments', {})

                    logger.info(f"   🎯 Function: {function_name}")
                    logger.info(f"   📝 Arguments: {arguments}")

                    asyncio.create_task(ChatEventHandler._handle_function_call(
                        session, ctx, function_name, arguments))

                # Handle MCP response from MQTT gateway
                elif message.get('type') == 'mcp':
                    logger.info("🔋 Processing MCP response from MQTT gateway")
                    asyncio.create_task(ChatEventHandler._handle_mcp_response(
                        session, ctx, message))

            except Exception as e:
                logger.error(f"Error processing data channel message: {e}")


# Helper functions for prompt management
async def update_agent_prompt_with_memory(
    session,
    enhanced_prompt: str,
    device_mac: str,
    memory_provider=None
) -> str:
    """
    Update agent prompt with memory injection

    Args:
        session: AgentSession instance
        enhanced_prompt: The enhanced prompt with placeholders
        device_mac: Device MAC address for memory lookup
        memory_provider: Optional memory provider (defaults to session provider)

    Returns:
        str: Final prompt with memory injected
    """
    try:
        # Get memory provider
        if memory_provider is None and hasattr(session, '_memory_provider'):
            memory_provider = session._memory_provider

        # Inject memory if provider available
        if memory_provider:
            try:
                memories = await memory_provider.query_memory("conversation history and user preferences")
                if memories:
                    # Use regex to replace memory tags
                    import re
                    enhanced_prompt = re.sub(
                        r"<memory>.*?</memory>",
                        f"<memory>\n{memories}\n</memory>",
                        enhanced_prompt,
                        flags=re.DOTALL
                    )
                    logger.info(f"💭 Injected memories into prompt ({len(memories)} chars)")
            except Exception as e:
                logger.warning(f"Could not inject memories: {e}")

        # Update session chat context
        if hasattr(session, 'history') and hasattr(session.history, 'messages'):
            if len(session.history.messages) > 0:
                if hasattr(session.history.messages[0], 'content'):
                    session.history.messages[0].content = enhanced_prompt
                    logger.info(f"✅ Updated session chat context with new prompt")

        # Update agent instructions
        if hasattr(session, '_agent'):
            session._agent._instructions = enhanced_prompt
            logger.info(f"✅ Updated agent instructions")

        return enhanced_prompt

    except Exception as e:
        logger.error(f"Error updating agent prompt with memory: {e}")
        import traceback
        logger.error(f"Traceback: {traceback.format_exc()}")
        return enhanced_prompt  # Return original prompt on error
