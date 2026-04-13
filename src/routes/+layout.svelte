<script lang="ts">
import { onMount } from 'svelte';
import { installUiExceptionTracing } from '$lib/client/exception-tracing';
import 'virtual:uno.css';
import '../app.css';

onMount(() => installUiExceptionTracing());
</script>

<slot />
