<script>
    import { fly } from 'svelte/transition';
    import { AlertTriangle, X } from 'lucide-svelte';
    import { speak } from '../utils/voice';

    let { 
        message = "", 
        visible = $bindable(false), 
        autoSpeak = true 
    } = $props();

    $effect(() => {
        if (visible && autoSpeak && message) {
            speak(message);
        }
    });

    function close() {
        visible = false;
    }
</script>

{#if visible}
    <div 
        class="alert-banner" 
        transition:fly={{ y: -100, duration: 400 }}
    >
        <div class="alert-content">
            <div class="icon-wrapper">
                <AlertTriangle size={24} color="#fff" />
            </div>
            <div class="text-content">
                <p class="message">{message}</p>
            </div>
            <button class="close-btn" onclick={close}>
                <X size={20} />
            </button>
        </div>
    </div>
{/if}

<style>
    .alert-banner {
        position: absolute;
        top: 85px; /* Below search bar */
        left: 20px;
        right: 40px; /* Space for right margin */
        z-index: 2000;
    }

    .alert-content {
        background: #ff3b30; /* Danger Red */
        color: white;
        border-radius: 12px;
        padding: 14px 16px;
        display: flex;
        align-items: center;
        box-shadow: 0 8px 30px rgba(255, 59, 48, 0.3);
    }

    .icon-wrapper {
        margin-right: 12px;
        background: rgba(255, 255, 255, 0.2);
        padding: 8px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
    }

    .text-content {
        flex: 1;
    }

    .message {
        margin: 0;
        font-weight: 600;
        font-size: 15px;
        line-height: 1.4;
    }

    .close-btn {
        background: none;
        border: none;
        color: rgba(255, 255, 255, 0.8);
        padding: 4px;
        cursor: pointer;
    }
</style>
