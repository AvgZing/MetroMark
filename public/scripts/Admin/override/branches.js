// Admin Map Editor — branch groups and options authoring.
function renderBranchGroupsEditor() {
  const container = els.branchGroupsList;
  if (!container) {
    return;
  }
  container.innerHTML = "";
  const groups = state.selectedBranchGroups || [];
  if (!groups.length) {
    const p = document.createElement("p");
    p.className = "microcopy";
    p.textContent = "No branch groups. Add one to tag alternative stop runs.";
    container.append(p);
    return;
  }

  groups.forEach((group, groupIndex) => {
    const card = document.createElement("div");
    card.className = "branch-group-card";

    const head = document.createElement("div");
    head.className = "branch-group-head";
    const labelInput = document.createElement("input");
    labelInput.type = "text";
    labelInput.className = "branch-group-label";
    labelInput.value = String(group.label || "");
    labelInput.placeholder = "Branch label (e.g. Via Bank)";
    labelInput.addEventListener("input", () => {
      group.label = labelInput.value;
    });
    const removeGroup = document.createElement("button");
    removeGroup.type = "button";
    removeGroup.className = "stop-order-remove";
    removeGroup.textContent = "×";
    removeGroup.title = "Remove branch group";
    removeGroup.addEventListener("click", () => {
      state.selectedBranchGroups.splice(groupIndex, 1);
      markRouteDirty("stops");
      renderBranchGroupsEditor();
      renderStopsOrderList();
    });
    head.append(labelInput, removeGroup);

    const optionsWrap = document.createElement("div");
    optionsWrap.className = "branch-options-list";
    (group.options || []).forEach((option, optionIndex) => {
      const row = document.createElement("div");
      row.className = "branch-option-row";
      const optionInput = document.createElement("input");
      optionInput.type = "text";
      optionInput.className = "branch-option-label";
      optionInput.value = String(option.label || "");
      optionInput.placeholder = "Option label";
      optionInput.addEventListener("input", () => {
        option.label = optionInput.value;
      });
      const removeOption = document.createElement("button");
      removeOption.type = "button";
      removeOption.className = "stop-order-remove";
      removeOption.textContent = "×";
      removeOption.title = "Remove option";
      removeOption.addEventListener("click", () => {
        group.options.splice(optionIndex, 1);
        markRouteDirty("stops");
        renderBranchGroupsEditor();
        renderStopsOrderList();
      });
      row.append(optionInput, removeOption);
      optionsWrap.append(row);
    });

    const addOption = document.createElement("button");
    addOption.type = "button";
    addOption.className = "btn btn-subtle branch-add-option";
    addOption.textContent = "+ option";
    addOption.addEventListener("click", () => {
      const stamp = Date.now().toString(36);
      group.options = Array.isArray(group.options) ? group.options : [];
      group.options.push({
        id: `opt-${groupIndex + 1}-${stamp}`,
        label: `Option ${group.options.length + 1}`
      });
      markRouteDirty("stops");
      renderBranchGroupsEditor();
      renderStopsOrderList();
    });

    card.append(head, optionsWrap, addOption);
    container.append(card);
  });
}

function addBranchGroup() {
  const stamp = Date.now().toString(36);
  state.selectedBranchGroups = state.selectedBranchGroups || [];
  state.selectedBranchGroups.push({
    id: `group-${state.selectedBranchGroups.length + 1}-${stamp}`,
    label: `Branch ${state.selectedBranchGroups.length + 1}`,
    options: [{ id: `opt-1-${stamp}`, label: "Option 1" }]
  });
  markRouteDirty("stops");
  renderBranchGroupsEditor();
  renderStopsOrderList();
}
